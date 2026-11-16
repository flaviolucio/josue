"""Separação em faixas com Demucs (htdemucs_6s): voz, guitarra, piano/violão, baixo,
bateria e outros. Não precisa de ffmpeg: o áudio é lido com soundfile/librosa.

    python separate.py "musica.mp3" pasta_saida
"""
import os
import sys
import time
import warnings

import numpy as np
import soundfile as sf
import torch

warnings.filterwarnings("ignore")

MODEL_NAME = "htdemucs_6s"
STEM_LABELS = {
    "vocals": "Vocais",
    "guitar": "Guitarra",
    "piano": "Piano/Teclado",
    "bass": "Baixo",
    "drums": "Bateria",
    "other": "Outros",
}
_model = None


def get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model as gm

        _model = gm(MODEL_NAME)
        _model.eval()
    return _model


def load_audio(path: str, sr: int):
    try:
        wav, file_sr = sf.read(path, always_2d=True, dtype="float32")  # (n, ch)
        wav = wav.T
    except Exception:
        import librosa

        wav, file_sr = librosa.load(path, sr=None, mono=False)
        if wav.ndim == 1:
            wav = wav[None, :]
    if file_sr != sr:
        import librosa

        wav = librosa.resample(wav, orig_sr=file_sr, target_sr=sr)
    if wav.shape[0] == 1:
        wav = np.concatenate([wav, wav], axis=0)
    return wav[:2].astype(np.float32)


def separate(path: str, out_dir: str, on_progress=None):
    """Gera out_dir/<stem>.ogg para cada faixa. Retorna a lista de faixas."""
    from demucs.apply import apply_model

    model = get_model()
    sr = model.samplerate
    wav = torch.from_numpy(load_audio(path, sr))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = ((wav - mean) / std)[None]

    # progresso: o apply_model divide em trechos; usamos o callback quando disponível
    total_len = max(1, x.shape[-1])
    seg_len = int(model.samplerate * float(getattr(model, "segment", 7.8)) * 0.75)
    kwargs = dict(shifts=1, split=True, overlap=0.25, progress=False, device="cpu")
    if on_progress is not None:
        def cb(d):
            try:
                if d.get("state") == "end":
                    on_progress(min(0.99, (d.get("segment_offset", 0) + seg_len) / total_len))
            except Exception:
                pass
        try:
            sources = apply_model(model, x, callback=cb, **kwargs)[0]
        except TypeError:
            sources = apply_model(model, x, **kwargs)[0]
    else:
        sources = apply_model(model, x, **kwargs)[0]
    sources = sources * std + mean

    os.makedirs(out_dir, exist_ok=True)
    stems = []
    for name, src in zip(model.sources, sources):
        audio = src.numpy().T
        peak = float(np.abs(audio).max())
        if peak > 0.99:
            audio = audio * (0.99 / peak)
        # grava em blocos: escrever tudo de uma vez faz o libsndfile (Vorbis) travar
        with sf.SoundFile(os.path.join(out_dir, f"{name}.ogg"), "w", samplerate=sr, channels=audio.shape[1],
                          format="OGG", subtype="VORBIS") as fh:
            for i in range(0, len(audio), sr):
                fh.write(np.ascontiguousarray(audio[i:i + sr]))
        rms = float(np.sqrt(np.mean(audio ** 2)))
        stems.append({"name": name, "label": STEM_LABELS.get(name, name), "rms": round(rms, 5)})
    return stems


if __name__ == "__main__":
    t = time.time()
    res = separate(sys.argv[1], sys.argv[2], on_progress=lambda p: print(f"\r{p:5.0%}", end="", flush=True))
    print()
    for s in res:
        print(s)
    print(f"{time.time() - t:.1f} s")
