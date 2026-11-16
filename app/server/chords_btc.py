"""Reconhecimento de acordes com o modelo treinado BTC (Bi-directional Transformer
for Chord recognition, ISMIR 2019). Uso:

    python chords_btc.py "musica.mp3"            -> JSON com [{t0, t1, chord}]
    python chords_btc.py "musica.mp3" --simple   -> só maiores/menores
"""
import json
import os
import sys
import warnings

import numpy as np
import torch

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
BTC_DIR = os.path.join(HERE, "models", "BTC-ISMIR19-master")
sys.path.insert(0, BTC_DIR)

from btc_model import BTC_model  # noqa: E402
from utils.hparams import HParams  # noqa: E402
from utils.mir_eval_modules import audio_file_to_features, idx2chord, idx2voca_chord  # noqa: E402

# nome BTC (ex.: "B:min7", "G:maj", "A:sus4") -> cifra (ex.: "Bm7", "G", "Asus4")
# notação brasileira (como no Cifra Club): 7M, m(7M), m7(b5), +
QUAL = {
    "maj": "", "min": "m", "7": "7", "min7": "m7", "maj7": "7M", "minmaj7": "m(7M)", "sus4": "sus4", "sus2": "sus2",
    "dim": "dim", "aug": "+", "min6": "m6", "maj6": "6", "dim7": "dim7", "hdim7": "m7(b5)",
}
SIMPLE = {"maj": "", "minmaj7": "m", "7": "", "maj7": "", "maj6": "", "sus4": "", "sus2": "", "aug": "",
          "min": "m", "min7": "m", "min6": "m", "dim": "m", "dim7": "m", "hdim7": "m"}

_cache = {}


def _load(voca: bool):
    if voca in _cache:
        return _cache[voca]
    config = HParams.load(os.path.join(BTC_DIR, "run_config.yaml"))
    if voca:
        config.feature["large_voca"] = True
        config.model["num_chords"] = 170
        model_file = os.path.join(BTC_DIR, "test", "btc_model_large_voca.pt")
        idx_to_chord = idx2voca_chord()
    else:
        model_file = os.path.join(BTC_DIR, "test", "btc_model.pt")
        idx_to_chord = idx2chord
    model = BTC_model(config=config.model)
    ck = torch.load(model_file, map_location="cpu", weights_only=False)
    model.load_state_dict(ck["model"])
    model.eval()
    _cache[voca] = (config, model, ck["mean"], ck["std"], idx_to_chord)
    return _cache[voca]


def to_name(label: str, simple: bool) -> str | None:
    if label in ("N", "X"):
        return None
    root, _, q = label.partition(":")
    q = q or "maj"
    q = q.split("/")[0]
    table = SIMPLE if simple else QUAL
    return root + table.get(q, "m" if q.startswith("min") else "")


def recognize(audio_path: str, simple: bool = False, min_dur: float = 0.6):
    config, model, mean, std, idx_to_chord = _load(True)
    feature, per_sec, length = audio_file_to_features(audio_path, config)
    feature = (feature.T - mean) / std
    n = config.model["timestep"]
    pad = n - (feature.shape[0] % n)
    feature = np.pad(feature, ((0, pad), (0, 0)), mode="constant")
    x = torch.tensor(feature, dtype=torch.float32).unsqueeze(0)
    preds = []
    with torch.no_grad():
        for t in range(feature.shape[0] // n):
            out, _ = model.self_attn_layers(x[:, n * t:n * (t + 1), :])
            p, _ = model.output_layer(out)
            preds.extend(p.squeeze().tolist())
    total = int(round(length / per_sec))
    preds = preds[:total]

    # agrupa quadros iguais em eventos
    events = []
    for i, idx in enumerate(preds):
        name = to_name(idx_to_chord[idx], simple)
        t = i * per_sec
        if events and events[-1]["chord"] == name:
            events[-1]["t1"] = t + per_sec
        else:
            events.append({"t0": t, "t1": t + per_sec, "chord": name})
    # remove trechos muito curtos (absorvidos pelo vizinho mais longo)
    changed = True
    while changed and len(events) > 1:
        changed = False
        k = min(range(len(events)), key=lambda j: events[j]["t1"] - events[j]["t0"])
        e = events[k]
        if e["t1"] - e["t0"] < min_dur:
            left = events[k - 1] if k > 0 else None
            right = events[k + 1] if k + 1 < len(events) else None
            tgt = left if (right is None or (left and left["t1"] - left["t0"] >= right["t1"] - right["t0"])) else right
            if tgt is left:
                left["t1"] = e["t1"]
            else:
                right["t0"] = e["t0"]
            events.pop(k)
            i = 1
            while i < len(events):
                if events[i]["chord"] == events[i - 1]["chord"]:
                    events[i - 1]["t1"] = events[i]["t1"]
                    events.pop(i)
                else:
                    i += 1
            changed = True
    out = [
        {"t0": round(e["t0"], 3), "t1": round(e["t1"], 3), "chord": e["chord"]}
        for e in events if e["chord"]
    ]
    return respell(out), length


# ---------- grafia: bemóis ou sustenidos conforme o tom ----------
SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
PC = {n: i for i, n in enumerate(SHARP)} | {n: i for i, n in enumerate(FLAT)}
FLAT_MAJOR_TONICS = {5, 10, 3, 8, 1}  # F, Bb, Eb, Ab, Db


def respell(chords):
    import re

    dur = [0.0] * 12  # duração por nota fundamental
    minor_dur = [0.0] * 12
    for c in chords:
        m = re.match(r"^([A-G][#b]?)(m(?!aj))?", c["chord"])
        if not m:
            continue
        pc = PC[m.group(1)]
        d = c["t1"] - c["t0"]
        dur[pc] += d
        if m.group(2):
            minor_dur[pc] += d
    # tom maior cujo campo harmônico (I ii iii IV V vi) cobre mais tempo
    best, best_score = 0, -1.0
    for k in range(12):
        score = sum(dur[(k + iv) % 12] for iv in (0, 2, 4, 5, 7, 9)) + dur[k]  # tônica pesa mais
        if score > best_score:
            best, best_score = k, score
    use_flats = best in FLAT_MAJOR_TONICS
    names = FLAT if use_flats else SHARP

    def fix(name):
        def sub(m):
            return names[PC[m.group(0)]]
        root = re.sub(r"^[A-G][#b]?", sub, name)
        return re.sub(r"(?<=/)[A-G][#b]?", sub, root)

    for c in chords:
        c["chord"] = fix(c["chord"])
    return chords


if __name__ == "__main__":
    path = sys.argv[1]
    simple = "--simple" in sys.argv
    chords, _ = recognize(path, simple=simple)
    json.dump(chords, sys.stdout, ensure_ascii=False)
