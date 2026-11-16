"""Tablatura automática: notas (Basic Pitch) -> corda/casa tocável -> ritmo quantizado.

    python tabs.py <pasta_das_faixas>   (pasta com guitar.ogg, bass.ogg, drums.ogg ...)

Saída (JSON):
{
  "bpm": 100.0, "beats": [...segundos...], "grid": 4,          # 4 subdivisões por batida (semicolcheias)
  "tracks": [
    {"id": "guitar", "name": "Guitarra", "tuning": [64,59,55,50,45,40],  # MIDI, corda 1 (aguda) -> 6
     "notes": [{"t0","t1","pitch","vel","string","fret","q0","qd","role"}]}
  ]
}
string: 1 = corda mais aguda. q0: posição na grade (semicolcheias desde o 1º tempo); qd: duração em semicolcheias.
role: "base" (acordes/levada) ou "solo" (linha melódica) — separação aproximada.
"""
import itertools
import json
import os
import sys
import warnings

import numpy as np

warnings.filterwarnings("ignore")
import logging  # noqa: E402

logging.getLogger().setLevel(logging.ERROR)

GUITAR = {"id": "guitar", "name": "Guitarra", "tuning": [64, 59, 55, 50, 45, 40], "frets": 20,
          "fmin": 75.0, "fmax": 1400.0, "stem": "guitar"}
BASS = {"id": "bass", "name": "Baixo", "tuning": [43, 38, 33, 28], "frets": 20, "pos_w": 0.25,
        "fmin": 38.0, "fmax": 400.0, "stem": "bass"}
MAX_SPAN = 4  # maior abertura de mão (em casas) para notas simultâneas


# ---------------- transcrição ----------------
def transcribe(path: str, inst: dict):
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    model = _model_cache.get("m") or Model(build_icassp_2022_model_path(FilenameSuffix.onnx))
    _model_cache["m"] = model
    _, _, events = predict(
        path, model,
        onset_threshold=0.55, frame_threshold=0.3, minimum_note_length=80,
        minimum_frequency=inst["fmin"], maximum_frequency=inst["fmax"],
        multiple_pitch_bends=False, melodia_trick=True,
    )
    notes = []
    lo = min(inst["tuning"])
    hi = max(inst["tuning"]) + inst["frets"]
    for t0, t1, pitch, amp, _ in events:
        if lo <= pitch <= hi and amp >= 0.18:
            notes.append({"t0": float(t0), "t1": float(t1), "pitch": int(pitch), "vel": round(float(amp), 3)})
    notes.sort(key=lambda n: (n["t0"], n["pitch"]))
    return notes


_model_cache: dict = {}


# ---------------- tempo / grade ----------------
def beat_grid(stem_dir: str):
    import librosa

    src = None
    for name in ("drums", "bass", "guitar", "other"):
        p = os.path.join(stem_dir, f"{name}.ogg")
        if os.path.exists(p):
            y, sr = librosa.load(p, sr=22050, mono=True)
            if src is None:
                src = y
            else:
                n = min(len(src), len(y))
                src = src[:n] + y[:n]
    tempo, beats = librosa.beat.beat_track(y=src, sr=22050, units="time", tightness=120)
    beats = [float(b) for b in np.atleast_1d(beats)]
    bpm = float(np.atleast_1d(tempo)[0])
    if len(beats) < 4:
        step = 60.0 / max(bpm, 60.0)
        beats = list(np.arange(0, len(src) / 22050, step))
    # estende a grade para trás até 0 s
    if len(beats) > 1:
        d = float(np.median(np.diff(beats)))
        while beats[0] - d > -1e-6:
            beats.insert(0, beats[0] - d)
    return bpm, beats


def quantize(t: float, beats: list, grid: int) -> int:
    """Tempo (s) -> índice na grade (beat * grid + subdivisão)."""
    b = np.searchsorted(beats, t, side="right") - 1
    b = int(np.clip(b, 0, len(beats) - 2))
    d = beats[b + 1] - beats[b]
    frac = (t - beats[b]) / d if d > 0 else 0.0
    return b * grid + int(round(frac * grid))


# ---------------- acordes (vindos do modelo BTC) ----------------
PCS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
       "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
OPEN_CHORDS = {("C", ""), ("D", ""), ("E", ""), ("G", ""), ("A", ""), ("Am", "m"), ("Em", "m"), ("Dm", "m")}


def parse_chord(name: str):
    """'F#m7/C#' -> (raiz, notas do acorde, posição-alvo da mão)."""
    import re

    m = re.match(r"^([A-G][#b]?)(.*?)(?:/([A-G][#b]?))?$", name or "")
    if not m:
        return None
    root = PCS[m.group(1)]
    q = m.group(2)
    minor = q.startswith("m") and not q.startswith("maj")
    ivs = [0, 3 if minor else 4, 7]
    if "sus4" in q: ivs[1] = 5
    if "sus2" in q: ivs[1] = 2
    if "dim" in q or "b5" in q: ivs[2] = 6
    if "maj7" in q: ivs.append(11)
    elif "7" in q: ivs.append(10)
    if "6" in q: ivs.append(9)
    if "9" in q: ivs.append(2)
    pcs = {(root + i) % 12 for i in ivs}
    if m.group(3):
        pcs.add(PCS[m.group(3)])
    simple = m.group(1) + ("m" if minor else "")
    if (simple, "m" if minor else "") in OPEN_CHORDS or (m.group(1), "") in OPEN_CHORDS and not minor:
        target = 0
    else:  # pestana: raiz na 6ª corda (E) ou na 5ª (A), a que ficar mais baixa
        target = min((root - 4) % 12, (root - 9) % 12) or 12
    return {"root": root, "pcs": pcs, "target": target}


def chord_at(chords, t):
    for c in chords:
        if c["t0"] - 0.05 <= t < c["t1"]:
            return c.get("_p")
    return None


# ---------------- notas -> corda/casa ----------------
def candidates(pitches, inst):
    """Todas as formas tocáveis de um grupo de notas simultâneas (uma nota por corda)."""
    tuning, frets = inst["tuning"], inst["frets"]
    options = []
    for p in pitches:
        opts = [(s, p - open_p) for s, open_p in enumerate(tuning) if 0 <= p - open_p <= frets]
        options.append(opts)
    out = []
    for combo in itertools.product(*options):
        strings = [c[0] for c in combo]
        if len(set(strings)) != len(strings):
            continue
        fretted = [f for _, f in combo if f > 0]
        span = (max(fretted) - min(fretted)) if fretted else 0
        if span > MAX_SPAN:
            continue
        out.append(combo)
        if len(out) > 400:
            break
    return out


def shape_cost(combo):
    fretted = [f for _, f in combo if f > 0]
    span = (max(fretted) - min(fretted)) if fretted else 0
    pos = min(fretted) if fretted else 0
    # prefere: pouca abertura, regiões baixas (perto da pestana), cordas soltas em acordes
    return span * 0.6 + pos * 0.08 + (0.0 if len(combo) > 2 else 0.02 * sum(f for _, f in combo))


def hand_pos(combo, prev):
    fretted = [f for _, f in combo if f > 0]
    return min(fretted) if fretted else prev


def assign_frets(groups, inst, targets=None):
    """Viterbi sobre os grupos de notas: custo da forma + custo de deslocar a mão."""
    states, scores, back = [], [], []
    for gi, g in enumerate(groups):
        pitches = [n["pitch"] for n in g]
        cands = candidates(pitches, inst)
        while not cands and len(g) > 1:  # impossível: tira a nota mais fraca
            g.remove(min(g, key=lambda n: n["vel"]))
            pitches = [n["pitch"] for n in g]
            cands = candidates(pitches, inst)
        if not cands:
            cands = [tuple()]
        cands = sorted(cands, key=shape_cost)[:40]
        cur_scores, cur_back = [], []
        for c in cands:
            base = shape_cost(c) if c else 5.0
            if c and inst.get("pos_w"):
                fr0 = [f for _, f in c if f > 0]
                base += inst["pos_w"] * (min(fr0) if fr0 else 0)
            tgt = targets[gi] if targets else None
            if tgt is not None and c:
                fr = [f for _, f in c if f > 0]
                hp = min(fr) if fr else 0
                # fica na região do desenho do acorde (aberto: casas 0-3; pestana: a partir da raiz)
                base += 0.3 * (max(0, hp - 3) if tgt == 0 else abs(hp - tgt))
            if gi == 0 or not states:
                cur_scores.append(base); cur_back.append(-1); continue
            best, arg = 1e9, 0
            for k, pc in enumerate(states[-1]):
                ph = hand_pos(pc, 0) if pc else 0
                ch = hand_pos(c, ph) if c else ph
                move = abs(ch - ph)
                cost = scores[-1][k] + base + move * 0.35 + (1.0 if move > 5 else 0.0)
                if cost < best:
                    best, arg = cost, k
            cur_scores.append(best); cur_back.append(arg)
        states.append(cands); scores.append(cur_scores); back.append(cur_back)
    # caminho
    if not states:
        return
    k = int(np.argmin(scores[-1]))
    for gi in range(len(groups) - 1, -1, -1):
        combo = states[gi][k]
        g = groups[gi]
        for n, (s, f) in zip(g, combo):
            n["string"] = s + 1
            n["fret"] = int(f)
        k = back[gi][k] if back[gi][k] >= 0 else 0


# ---------------- base x solo ----------------
def label_roles(notes, beats, grid):
    """Por batida: muitas notas juntas (acordes) = base; notas soltas e agudas = solo."""
    if not notes:
        return
    by_beat: dict[int, list] = {}
    for n in notes:
        by_beat.setdefault(n["q0"] // grid, []).append(n)
    for b, ns in by_beat.items():
        groups: dict[int, list] = {}
        for n in ns:
            groups.setdefault(n["q0"], []).append(n)
        poly = max(len(g) for g in groups.values())
        for g in groups.values():
            for n in g:
                if poly >= 3 or len(g) >= 2:
                    n["role"] = "base"
                else:
                    # nota isolada: solo se estiver acima da região típica de acordes
                    n["role"] = "solo" if n["pitch"] >= 64 else "base"


# ---------------- pipeline ----------------
def build_track(stem_dir: str, inst: dict, bpm_beats, chords=None):
    path = os.path.join(stem_dir, f"{inst['stem']}.ogg")
    if not os.path.exists(path):
        return None
    bpm, beats = bpm_beats
    grid = 4
    notes = transcribe(path, inst)
    if not notes:
        return None
    if chords:
        kept = []
        for n in notes:
            p = chord_at(chords, n["t0"] + 0.03)
            # harmônicos/ressonâncias fora do acorde e fracos são descartados
            if p is None or (n["pitch"] % 12) in p["pcs"] or n["vel"] >= 0.45:
                kept.append(n)
        notes = kept
    for n in notes:
        n["q0"] = quantize(n["t0"], beats, grid)
        n["qd"] = max(1, quantize(n["t1"], beats, grid) - n["q0"])
    # agrupa notas que caem no mesmo ponto da grade (acordes); remove repetidas
    groups: dict[int, dict] = {}
    for n in notes:
        g = groups.setdefault(n["q0"], {})
        if n["pitch"] not in g or g[n["pitch"]]["vel"] < n["vel"]:
            g[n["pitch"]] = n
    ordered = [sorted(g.values(), key=lambda n: -n["pitch"])[: len(inst["tuning"])] for _, g in sorted(groups.items())]
    targets = None
    if chords and inst["id"] == "guitar":
        targets = []
        for g in ordered:
            p = chord_at(chords, g[0]["t0"] + 0.03)
            targets.append(p["target"] if p else None)
    assign_frets(ordered, inst, targets)
    out = [n for g in ordered for n in g if "string" in n]
    if inst["id"] == "guitar":
        label_roles(out, beats, grid)
    else:
        for n in out:
            n["role"] = "base"
    for n in out:
        n["t0"] = round(n["t0"], 3); n["t1"] = round(n["t1"], 3)
    return {"id": inst["id"], "name": inst["name"], "tuning": inst["tuning"], "notes": out}


def build_tabs(stem_dir: str, stems_info=None, on_progress=None, chords=None):
    rms = {s["name"]: s["rms"] for s in (stems_info or [])}
    chords = [dict(c) for c in (chords or [])]
    for c in chords:
        c["_p"] = parse_chord(c["chord"])
    bb = beat_grid(stem_dir)
    if on_progress:
        on_progress(0.15)
    tracks = []
    for i, inst in enumerate((GUITAR, BASS)):
        if rms and rms.get(inst["stem"], 1) < 0.004:
            continue
        t = build_track(stem_dir, inst, bb, chords)
        if t:
            tracks.append(t)
        if on_progress:
            on_progress(0.15 + 0.85 * (i + 1) / 2)
    return {"bpm": round(bb[0], 2), "beats": [round(b, 3) for b in bb[1]], "grid": 4, "tracks": tracks}


def ascii_tab(track, q_from=0, q_to=64, width_per_q=2):
    names = ["e", "B", "G", "D", "A", "E"] if len(track["tuning"]) == 6 else ["G", "D", "A", "E"]
    rows = [[name + "|"] + ["-" * width_per_q] * (q_to - q_from) for name in names]
    for n in track["notes"]:
        if q_from <= n["q0"] < q_to:
            cell = str(n["fret"]).ljust(width_per_q, "-")
            rows[n["string"] - 1][1 + n["q0"] - q_from] = cell
    for r in rows:
        for q in range(0, q_to - q_from, 16):  # barra a cada compasso 4/4
            r[1 + q] = "|" + r[1 + q][1:] if q else r[1 + q]
    return "\n".join("".join(r) for r in rows)


if __name__ == "__main__":
    import time

    t = time.time()
    d = sys.argv[1]
    chords = None
    if len(sys.argv) > 3:
        with open(sys.argv[3], encoding="utf-8") as f:
            chords = json.load(f)
    res = build_tabs(d, on_progress=lambda p: print(f"\r{p:4.0%}", end="", flush=True), chords=chords)
    print(f"\n{time.time() - t:.1f} s  bpm={res['bpm']}")
    for tr in res["tracks"]:
        roles = {r: sum(1 for n in tr["notes"] if n["role"] == r) for r in ("base", "solo")}
        print(f"{tr['name']}: {len(tr['notes'])} notas {roles}")
        print(ascii_tab(tr, 32, 96))
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
