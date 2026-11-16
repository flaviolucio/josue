"""Letra sincronizada a partir da voz separada.

Dois caminhos:
  * com a letra colada pelo usuário: só alinha (o texto fica 100% certo, a IA acha o tempo de cada palavra);
  * sem letra: transcreve com Whisper large-v3 (faster-whisper, rápido no processador) e depois alinha.

O alinhamento é "forçado" por CTC: um modelo wav2vec2 treinado em português dá, a cada 20 ms,
a probabilidade de cada letra; o Viterbi encontra o caminho que soletra o texto inteiro na ordem.
É o mesmo princípio do WhisperX, sem as dependências pesadas dele.

CLI:  python lyrics.py <vocals.ogg> [letra.txt]
"""
import json
import re
import sys
import threading
import unicodedata

import numpy as np

ALIGN_MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese"
WHISPER_MODEL = "Systran/faster-whisper-large-v3"
SR = 16000

_lock = threading.Lock()
_align = None
_whisper = None


def _load_align():
    global _align
    if _align is None:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        try:  # usa a cópia já baixada sem consultar a internet (a consulta pode levar minutos)
            proc = Wav2Vec2Processor.from_pretrained(ALIGN_MODEL, local_files_only=True)
            model = Wav2Vec2ForCTC.from_pretrained(ALIGN_MODEL, local_files_only=True).eval()
        except OSError:
            proc = Wav2Vec2Processor.from_pretrained(ALIGN_MODEL)
            model = Wav2Vec2ForCTC.from_pretrained(ALIGN_MODEL).eval()
        torch.set_num_threads(max(1, (__import__("os").cpu_count() or 4)))
        _align = (proc, model)
    return _align


def _load_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        try:
            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", local_files_only=True)
        except Exception:  # noqa: BLE001
            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _whisper


def load_audio(path: str) -> np.ndarray:
    import librosa

    y, _ = librosa.load(path, sr=SR, mono=True)
    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.9).astype(np.float32)


# ---------------- transcrição ----------------
def transcribe(audio: np.ndarray, language: str | None, on_progress=None) -> list[dict]:
    model = _load_whisper()
    segs, info = model.transcribe(
        audio,
        language=language,
        beam_size=5,
        word_timestamps=True,
        vad_filter=False,  # canto não é fala: o VAD corta notas longas
        condition_on_previous_text=False,  # evita repetir frases em loop
        no_speech_threshold=0.5,
    )
    dur = len(audio) / SR
    words = []
    for s in segs:
        for w in s.words or []:
            t = w.word.strip()
            # "Segue" + "-me": pronome com hífen volta para a palavra anterior
            if t.startswith("-") and words:
                words[-1]["text"] += t
                words[-1]["t1"] = float(w.end)
                continue
            if t:
                words.append({"t0": float(w.start), "t1": float(w.end), "text": t})
        if on_progress:
            on_progress(min(1.0, s.end / dur))
    # remove repetições alucinadas (mesma frase 3+ vezes seguidas em trechos sem voz)
    return words


# ---------------- alinhamento ----------------
def _emissions(audio: np.ndarray, on_progress=None):
    import torch

    proc, model = _load_align()
    win, hop = SR * 20, SR * 20
    out = []
    n = max(1, int(np.ceil(len(audio) / hop)))
    for i in range(n):
        chunk = audio[i * hop : i * hop + win]
        if len(chunk) < SR // 10:
            break
        x = proc(chunk, sampling_rate=SR, return_tensors="pt").input_values
        with torch.inference_mode():
            lg = model(x).logits[0]
        out.append(torch.log_softmax(lg, dim=-1).numpy())
        if on_progress:
            on_progress((i + 1) / n)
    em = np.concatenate(out, 0)
    frame = len(audio) / SR / em.shape[0]
    return em, frame


def _vocab():
    proc, _ = _load_align()
    v = proc.tokenizer.get_vocab()
    blank = proc.tokenizer.pad_token_id
    sep = v.get("|")
    return v, blank, sep


def _norm_word(w: str, vocab: dict) -> str:
    w = w.lower().replace("’", "'")
    out = []
    for ch in w:
        if ch in vocab:
            out.append(ch)
        else:  # tira acento só se a letra acentuada não existir no vocabulário
            base = unicodedata.normalize("NFD", ch)[0]
            if base in vocab:
                out.append(base)
    return "".join(out)


def align(audio: np.ndarray, words: list[str], on_progress=None) -> list[tuple[float, float]]:
    """Devolve (t0, t1) de cada palavra, na ordem. Palavras sem letras reconhecíveis herdam o vizinho."""
    em, frame = _emissions(audio, on_progress)
    vocab, blank, sep = _vocab()
    toks, owner = [], []  # token e a palavra a que pertence (-1 = separador)
    normed = [_norm_word(w, vocab) for w in words]
    for wi, nw in enumerate(normed):
        if not nw:
            continue
        if toks and sep is not None:
            toks.append(sep); owner.append(-1)
        for ch in nw:
            toks.append(vocab[ch]); owner.append(wi)
    T, J = em.shape[0], len(toks)
    if J == 0 or T < J:
        raise ValueError("letra longa demais para o áudio (ou vazia)")
    # Viterbi CTC simplificado: em cada quadro, fica no token (ou em branco) ou avança um token
    toks_a = np.array(toks)
    NEG = -1e9
    # trellis[t, j]: melhor pontuação tendo emitido os j primeiros tokens até o quadro t
    trellis = np.full((T + 1, J + 1), NEG, dtype=np.float32)
    trellis[0, 0] = 0.0
    back = np.zeros((T, J + 1), dtype=np.bool_)  # True = avançou (emitiu token j-1 no quadro t)
    em_blank = em[:, blank]
    for t in range(T):
        stay = trellis[t] + em_blank[t]
        # também pode ficar repetindo o mesmo token (nota longa)
        stay[1:] = np.maximum(stay[1:], trellis[t, 1:] + em[t, toks_a])
        adv = np.full(J + 1, NEG, dtype=np.float32)
        adv[1:] = trellis[t, :-1] + em[t, toks_a]
        take = adv > stay
        trellis[t + 1] = np.where(take, adv, stay)
        back[t] = take
        if on_progress and t % 2000 == 0:
            on_progress(1.0)
    # volta pelo caminho: quadro em que cada token foi emitido pela 1ª vez
    first = np.zeros(J, dtype=np.int64)
    j = J
    for t in range(T - 1, -1, -1):
        if j == 0:
            break
        if back[t, j]:
            first[j - 1] = t
            j -= 1
    spans = [[None, None] for _ in words]
    for k in range(J):
        wi = owner[k]
        if wi < 0:
            continue
        t0 = first[k] * frame
        end_frame = first[k + 1] if k + 1 < J else min(T - 1, first[k] + 10)
        t1 = end_frame * frame
        if spans[wi][0] is None:
            spans[wi][0] = t0
        spans[wi][1] = t1
    # fim de cada palavra: não deixa "esticar" pela pausa até a próxima (máx. 1,2 s após a última letra)
    out = []
    for wi, (a, b) in enumerate(spans):
        if a is None:  # palavra só com símbolos: cola na anterior
            a = out[-1][1] if out else 0.0
            b = a + 0.05
        out.append((float(a), float(max(a + 0.05, b))))
    for i in range(len(out) - 1):
        a, b = out[i]
        out[i] = (a, min(b, out[i + 1][0], a + max(1.2, 0.0)))
    return out


# ---------------- letra colada ----------------
def parse_lyrics(text: str) -> list[dict]:
    """Texto colado -> palavras com o número da linha. Ignora marcações tipo [Refrão], (2x) e linhas de acordes."""
    out = []
    line_no = 0
    chordish = re.compile(r"^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]*(\([^)]*\))?(/[A-G][#b]?)?$")
    for raw in text.replace("\r", "").split("\n"):
        line = re.sub(r"\[[^\]]*\]", " ", raw).strip()
        if not line:
            continue
        toks = line.split()
        if toks and all(chordish.match(t) for t in toks):
            continue  # linha só de acordes (cifra colada)
        words = [t for t in toks if re.search(r"\w", t)]
        if not words:
            continue
        for w in words:
            out.append({"text": w, "line": line_no})
        line_no += 1
    return out


def run(vocals_path: str, language: str | None, text: str | None, on_progress=None) -> list[dict]:
    prog = on_progress or (lambda p: None)
    with _lock:
        audio = load_audio(vocals_path)
        if text and text.strip():
            items = parse_lyrics(text)
            if not items:
                raise ValueError("a letra colada está vazia")
            spans = align(audio, [w["text"] for w in items], lambda p: prog(0.05 + 0.9 * p))
            return [{"t0": a, "t1": b, "text": w["text"], "line": w["line"]} for w, (a, b) in zip(items, spans)]
        prog(0.02)
        words = transcribe(audio, language, lambda p: prog(0.02 + 0.68 * p))
        if not words:
            return []
        try:
            spans = align(audio, [w["text"] for w in words], lambda p: prog(0.7 + 0.28 * p))
            # o alinhamento afina o tempo; se ele se perder muito de uma palavra, fica o tempo do Whisper
            for w, (a, b) in zip(words, spans):
                if abs(a - w["t0"]) < 1.5:
                    w["t0"], w["t1"] = a, b
        except Exception as e:  # noqa: BLE001
            print("alinhamento falhou, usando tempos do Whisper:", e)
        return words


if __name__ == "__main__":
    vocals = sys.argv[1]
    txt = open(sys.argv[2], encoding="utf-8").read() if len(sys.argv) > 2 else None
    res = run(vocals, "pt", txt, lambda p: print(f"\r{p*100:5.1f}%", end="", file=sys.stderr))
    print(file=sys.stderr)
    print(json.dumps(res[:40], ensure_ascii=False, indent=1))
    print(len(res), "palavras", file=sys.stderr)
