"""Pipeline pesado (GPU): Demucs -> Whisper large-v3 -> acordes -> BPM/batidas -> tom -> compasso -> seções.

Cada etapa chama `report(step, progress, label)` para a barra de progresso do app.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np

from . import config

Report = Callable[[int, float, str], None]

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"}


# ---------------------------------------------------------------- 1. separação
def separate(audio: Path, workdir: Path, report: Report) -> tuple[Path, Path]:
    """Demucs (htdemucs) em dois stems: vocals e no_vocals."""
    report(1, 0.05, "Separando voz e instrumental (Demucs)")
    cmd = [sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", config.DEMUCS_MODEL,
           "-d", config.DEMUCS_DEVICE, "-o", str(workdir), str(audio)]
    subprocess.run(cmd, check=True, capture_output=True)
    out = workdir / config.DEMUCS_MODEL / audio.stem
    vocals, inst = out / "vocals.wav", out / "no_vocals.wav"
    if not vocals.exists() or not inst.exists():
        raise RuntimeError("Demucs não gerou as faixas esperadas")
    report(1, 1.0, "Faixas separadas")
    return vocals, inst


# ---------------------------------------------------------------- 2. letra
_whisper = None


def transcribe(vocals: Path, report: Report, language: str | None = None) -> tuple[list[dict], str]:
    global _whisper
    from faster_whisper import WhisperModel

    report(2, 0.02, "Carregando Whisper " + config.WHISPER_MODEL)
    if _whisper is None:
        _whisper = WhisperModel(config.WHISPER_MODEL, device=config.WHISPER_DEVICE, compute_type=config.WHISPER_COMPUTE)
    # idioma automático com prioridade para pt: se a detecção ficar em dúvida, usa pt
    if language is None:
        _, info = _whisper.transcribe(str(vocals), beam_size=1, without_timestamps=True)
        language = info.language if info.language_probability >= 0.6 else "pt"
    segments, info = _whisper.transcribe(
        str(vocals), language=language, word_timestamps=True, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500}, beam_size=5, condition_on_previous_text=False,
    )
    words: list[dict] = []
    total = max(1.0, info.duration)
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"t0": float(w.start), "t1": float(w.end), "text": text})
        report(2, min(0.99, seg.end / total), "Transcrevendo a letra")
    return words, language


# ---------------------------------------------------------------- utilidades
def note_name(i: int, flats: bool = False) -> str:
    return (FLAT_NOTES if flats else NOTES)[i % 12]


def load_mono(path: Path, sr: int = 22050) -> np.ndarray:
    import librosa
    y, _ = librosa.load(str(path), sr=sr, mono=True)
    return y


KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate_key(chroma: np.ndarray) -> tuple[str, int, bool]:
    prof = chroma.mean(axis=1)
    best, root, minor = -2.0, 0, False
    for r in range(12):
        rot = np.roll(prof, -r)
        for is_min, tpl in ((False, KK_MAJOR), (True, KK_MINOR)):
            c = float(np.corrcoef(rot, tpl)[0, 1])
            if c > best:
                best, root, minor = c, r, is_min
    flat = note_name(root, True) + ("m" if minor else "")
    name = flat if flat in FLAT_KEYS else note_name(root) + ("m" if minor else "")
    return name, root, minor


# ---------------------------------------------------------------- 3. acordes
QUALITIES = [  # (sufixo, intervalos, limiar da nota de tensão)
    ("7", [0, 4, 7, 10], 0.45), ("m7", [0, 3, 7, 10], 0.45), ("maj7", [0, 4, 7, 11], 0.7),
    ("sus4", [0, 5, 7], 0.6), ("sus2", [0, 2, 7], 0.6), ("add9", [0, 2, 4, 7], 0.55),
]


def _refine(name: str, chroma: np.ndarray, bass: np.ndarray, flats: bool) -> str:
    """madmom só diz maior/menor; aqui testamos 7ª, sus, add9 e inversões pelo croma do trecho."""
    if name == "N":
        return name
    root_s, _, qual = name.partition(":")
    root = NOTES.index(root_s) if root_s in NOTES else FLAT_NOTES.index(root_s)
    minor = qual.startswith("min")
    c = chroma / (chroma.max() + 1e-9)
    base = [0, 3, 7] if minor else [0, 4, 7]
    out = note_name(root, flats) + ("m" if minor else "")
    best_gain = 0.0
    for suf, iv, thr in QUALITIES:
        if minor and suf in ("7", "maj7", "add9"):
            continue
        if not minor and suf == "m7":
            continue
        extra = [i for i in iv if i not in base]
        missing = [i for i in base if i not in iv]
        gain = min(c[(root + i) % 12] for i in extra) - thr
        if missing:  # sus: a terça precisa estar fraca
            gain = min(gain, 0.35 - max(c[(root + i) % 12] for i in missing))
        if gain > best_gain:
            best_gain = gain
            out = note_name(root, flats) + suf
    b = bass / (bass.max() + 1e-9)
    b_arg = int(np.argmax(b))
    tones = [(root + i) % 12 for i in (base + [10, 11])]
    if b_arg != root and b_arg in tones and b[root] < 0.55:
        out += "/" + note_name(b_arg, flats)
    return out


def recognize_chords(inst: Path, duration: float, key_name: str, report: Report) -> list[dict]:
    import librosa
    report(3, 0.05, "Reconhecendo acordes")
    flats = key_name in FLAT_KEYS
    try:
        from madmom.features.chords import CNNChordFeatureProcessor, CRFChordRecognitionProcessor
        feats = CNNChordFeatureProcessor()(str(inst))
        report(3, 0.5, "Reconhecendo acordes")
        segs = CRFChordRecognitionProcessor()(feats)
        raw = [(float(s), float(e), str(l)) for s, e, l in segs]
    except Exception:  # sem madmom: modelos de acordes sobre croma (mesmo método do app web)
        raw = _template_chords(inst)
    y = load_mono(inst)
    chroma = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=2048)
    bass = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=2048, fmin=librosa.note_to_hz("C1"), n_octaves=2)
    fps = 22050 / 2048
    out: list[dict] = []
    for i, (s, e, label) in enumerate(raw):
        if label == "N" or e - s < 0.3:
            continue
        a, b = int(s * fps), max(int(s * fps) + 1, int(e * fps))
        name = _refine(label, chroma[:, a:b].mean(axis=1), bass[:, a:b].mean(axis=1), flats)
        if out and out[-1]["chord"] == name and s - out[-1]["t1"] < 0.5:
            out[-1]["t1"] = e
        else:
            out.append({"t0": s, "t1": min(e, duration), "chord": name})
        if i % 20 == 0:
            report(3, 0.5 + 0.5 * i / max(1, len(raw)), "Refinando acordes")
    return out


def _template_chords(inst: Path) -> list[tuple[float, float, str]]:
    import librosa
    y = load_mono(inst)
    hop = 2048
    chroma = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=hop)
    chroma = librosa.decompose.nn_filter(chroma, aggregate=np.median, metric="cosine")
    labels, tpl = [], []
    for r in range(12):
        for q, iv in (("maj", [0, 4, 7]), ("min", [0, 3, 7])):
            t = np.zeros(12); t[[(r + i) % 12 for i in iv]] = 1
            labels.append(f"{NOTES[r]}:{q}"); tpl.append(t / np.linalg.norm(t))
    T = np.array(tpl)
    norm = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)
    prob = np.exp(10 * (T @ norm))
    prob /= prob.sum(axis=0, keepdims=True)
    trans = librosa.sequence.transition_loop(len(labels), 0.95)
    path = librosa.sequence.viterbi(prob, trans)
    times = librosa.frames_to_time(np.arange(len(path) + 1), sr=22050, hop_length=hop)
    out: list[tuple[float, float, str]] = []
    for i, p in enumerate(path):
        if out and out[-1][2] == labels[p]:
            out[-1] = (out[-1][0], float(times[i + 1]), labels[p])
        else:
            out.append((float(times[i]), float(times[i + 1]), labels[p]))
    return out


# ---------------------------------------------------------------- 4/6. batidas, BPM e compasso
def beats_and_meter(audio: Path, report: Report) -> tuple[float, list[float], str, list[float]]:
    report(4, 0.05, "Detectando batidas")
    try:
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
        act = RNNDownBeatProcessor()(str(audio))
        report(4, 0.6, "Detectando batidas")
        res = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(act)
        beats = [float(t) for t, _ in res]
        downbeats = [float(t) for t, pos in res if int(pos) == 1]
        positions = [int(pos) for _, pos in res]
        per_bar = max(positions) if positions else 4
    except Exception:
        import librosa
        y = load_mono(audio)
        _, frames = librosa.beat.beat_track(y=y, sr=22050, units="frames")
        beats = librosa.frames_to_time(frames, sr=22050).tolist()
        downbeats = beats[::4]
        per_bar = 4
    bpm = 60.0 / float(np.median(np.diff(beats))) if len(beats) > 2 else 120.0
    report(6, 0.5, "Detectando compasso")
    if per_bar == 3:
        time_sig = "6/8" if bpm >= 150 else "3/4"
    else:
        time_sig = "4/4"
    return bpm, beats, time_sig, downbeats


# ---------------------------------------------------------------- 7. seções
def detect_sections(audio: Path, downbeats: list[float], words: list[dict], duration: float, report: Report) -> list[dict]:
    import librosa
    report(7, 0.1, "Encontrando seções")
    y = load_mono(audio)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=y, sr=22050, hop_length=hop, n_mfcc=13)
    rms = librosa.feature.rms(y=y, hop_length=hop)
    bars = downbeats if len(downbeats) > 8 else list(np.arange(0, duration, 2.0))
    bar_frames = librosa.time_to_frames(bars, sr=22050, hop_length=hop)
    feat = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=1) * 0.5])
    sync = librosa.util.sync(feat, bar_frames, aggregate=np.median)
    energy = librosa.util.sync(rms, bar_frames, aggregate=np.mean)[0]
    nbars = sync.shape[1]
    k = int(np.clip(round(duration / 20), 3, 12))
    if nbars <= k:
        return [{"t0": 0.0, "t1": duration, "label": "Verso" if words else "Instrumental"}]
    bounds = librosa.segment.agglomerative(sync, k)
    edges = [bars[min(b, len(bars) - 1)] if b > 0 else 0.0 for b in bounds] + [duration]
    report(7, 0.6, "Rotulando seções")

    def coverage(t0: float, t1: float) -> float:
        cov = sum(max(0.0, min(t1, w["t1"]) - max(t0, w["t0"])) for w in words)
        return min(1.0, cov / max(0.001, t1 - t0))

    segs = []
    for i in range(len(edges) - 1):
        t0, t1 = edges[i], edges[i + 1]
        b0, b1 = bounds[i], (bounds[i + 1] if i + 1 < len(bounds) else nbars)
        segs.append({"t0": t0, "t1": t1, "voc": coverage(t0, t1),
                     "feat": sync[:, b0:max(b0 + 1, b1)].mean(axis=1), "energy": float(energy[b0:max(b0 + 1, b1)].mean())})
    # agrupa trechos parecidos
    group = [-1] * len(segs)
    g = 0
    for i, s in enumerate(segs):
        if group[i] >= 0:
            continue
        group[i] = g
        for j in range(i + 1, len(segs)):
            a, b = s["feat"], segs[j]["feat"]
            if group[j] < 0 and float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)) > 0.97:
                group[j] = g
        g += 1
    vocal = [i for i, s in enumerate(segs) if s["voc"] > 0.15 or not words]
    counts: dict[int, list[int]] = {}
    for i in vocal:
        counts.setdefault(group[i], []).append(i)
    chorus = -1
    rep = [(len(v) * 2 + np.mean([segs[i]["energy"] for i in v]), gid) for gid, v in counts.items() if len(v) >= 2]
    if rep:
        chorus = max(rep)[1]
    elif len(vocal) >= 2:
        chorus = group[max(vocal[1:], key=lambda i: segs[i]["energy"])]
    first_chorus = next((i for i in range(len(segs)) if group[i] == chorus), -1)
    out: list[dict] = []
    for i, s in enumerate(segs):
        if not (s["voc"] > 0.15 or not words):
            label = "Intro" if i == 0 else "Final" if i == len(segs) - 1 else ("Solo" if s["t1"] - s["t0"] > 12 else "Instrumental")
        elif group[i] == chorus:
            label = "Refrão"
        elif sum(1 for x in group if x == group[i]) == 1 and 0 <= first_chorus < i < len(segs) - 1:
            label = "Pré-refrão" if group[i + 1] == chorus and s["t1"] - s["t0"] < 20 else "Ponte"
        else:
            label = "Verso"
        if out and out[-1]["label"] == label:
            out[-1]["t1"] = s["t1"]
        else:
            out.append({"t0": s["t0"], "t1": s["t1"], "label": label})
    return out


# ---------------------------------------------------------------- tudo junto
def run(audio: Path, report: Report, language: str | None = None) -> dict:
    import librosa
    duration = float(librosa.get_duration(path=str(audio)))
    if duration > config.MAX_SECONDS:
        raise ValueError("A música passa de 20 minutos.")
    work = Path(tempfile.mkdtemp(prefix="cifra-"))
    try:
        vocals, inst = separate(audio, work, report)
        words, lang = transcribe(vocals, report, language)
        y = load_mono(inst)
        chroma = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=2048)
        key_name, _, _ = estimate_key(chroma)
        chords = recognize_chords(inst, duration, key_name, report)
        bpm, beats, time_sig, downbeats = beats_and_meter(audio, report)
        report(5, 1.0, "Tonalidade: " + key_name)
        report(6, 1.0, "Compasso: " + time_sig)
        sections = detect_sections(audio, downbeats, words, duration, report)
        return {"duration": duration, "language": lang, "bpm": round(bpm), "key": key_name, "time_sig": time_sig,
                "words": words, "chords": chords, "sections": sections, "beats": beats}
    finally:
        shutil.rmtree(work, ignore_errors=True)
