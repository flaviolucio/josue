"""Transposição e alinhamento para a exportação (mesmas regras do app web)."""
from __future__ import annotations

import re

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
FLAT_KEYS = {"F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"}
LETTER = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
CHORD_RE = re.compile(r"^([A-G])([#b]?)(.*?)(?:/([A-G][#b]?))?$")


def _idx(n: str) -> int:
    v = LETTER[n[0]] + (1 if n[1:] == "#" else -1 if n[1:] == "b" else 0)
    return v % 12


def transpose(chord: str, semis: int, flats: bool = False) -> str:
    m = CHORD_RE.match(chord.strip())
    if not m:
        return chord
    names = FLATS if flats else NOTES
    root = names[(_idx(m.group(1) + m.group(2)) + semis) % 12]
    out = root + m.group(3)
    if m.group(4):
        out += "/" + names[(_idx(m.group(4)) + semis) % 12]
    return out


def transpose_key(key: str, semis: int) -> str:
    if not key:
        return key
    minor = key.endswith("m")
    base = transpose(key.rstrip("m"), semis)
    flat = transpose(key.rstrip("m"), semis, True) + ("m" if minor else "")
    return flat if flat in FLAT_KEYS else base + ("m" if minor else "")


def build_lines(words: list[dict], chords: list[dict], sections: list[dict]) -> list[tuple[str, list]]:
    """Retorna [(rótulo_da_seção, [linha...])], linha = ('lyric', [(palavra, [(offset, acorde)])]) ou ('chords', [acorde])."""
    secs = sections or [{"t0": 0, "t1": 1e9, "label": ""}]

    def sec_of(t: float) -> int:
        k = 0
        for i, s in enumerate(secs):
            if t >= s["t0"] - 0.05:
                k = i
        return k

    raw: list[dict] = []
    for i, w in enumerate(words):
        sec = sec_of(w["t0"])
        prev = words[i - 1] if i else None
        if (not raw or raw[-1]["sec"] != sec or w["t0"] - prev["t1"] > 0.9 or len(raw[-1]["idx"]) >= 9
                or (prev["text"][-1:] in ".!?;" and len(raw[-1]["idx"]) >= 3)):
            raw.append({"sec": sec, "idx": [i], "t0": w["t0"], "t1": w["t1"]})
        else:
            raw[-1]["idx"].append(i)
            raw[-1]["t1"] = w["t1"]
    placed: dict[int, list] = {}
    orphans: list[dict] = []
    for c in chords:
        best = None
        for line in raw:
            if c["t0"] < line["t0"] - 0.6 or c["t0"] > line["t1"] + 0.35:
                continue
            for i in line["idx"]:
                w = words[i]
                d = 0 if w["t0"] <= c["t0"] < w["t1"] else abs(w["t0"] - c["t0"])
                if best is None or d < best[0]:
                    best = (d, i)
        if best and best[0] <= 0.6:
            w = words[best[1]]
            off = 0
            if c["t0"] > w["t0"] and w["t1"] > w["t0"] and len(w["text"]) > 2:
                off = int(min(0.999, (c["t0"] - w["t0"]) / (w["t1"] - w["t0"])) * len(w["text"]))
            placed.setdefault(best[1], []).append((off, c["chord"]))
        else:
            orphans.append(c)
    items: list[tuple[float, int, tuple]] = []
    for line in raw:
        items.append((line["t0"], line["sec"], ("lyric", [(words[i]["text"], sorted(placed.get(i, []))) for i in line["idx"]])))
    group: list[dict] = []
    for c in orphans:
        if group and sec_of(c["t0"]) == sec_of(group[-1]["t0"]) and len(group) < 8 and c["t0"] - group[-1]["t1"] < 4:
            group.append(c)
        else:
            if group:
                items.append((group[0]["t0"], sec_of(group[0]["t0"]), ("chords", [g["chord"] for g in group])))
            group = [c]
    if group:
        items.append((group[0]["t0"], sec_of(group[0]["t0"]), ("chords", [g["chord"] for g in group])))
    items.sort(key=lambda x: x[0])
    blocks: list[tuple[str, list]] = []
    last = -1
    for _, sec, line in items:
        if sec != last:
            blocks.append((secs[sec]["label"], []))
            last = sec
        blocks[-1][1].append(line)
    return blocks


def lyric_rows(words: list) -> tuple[str, str]:
    lyric, chord_row = "", ""
    for wi, (text, chords) in enumerate(words):
        if wi:
            lyric += " "
        inserted = 0
        for off, name in chords:
            pos = len(lyric) + off + inserted
            need = len(chord_row) + (1 if chord_row else 0)
            if pos < need:
                pad = need - pos
                cut = off + inserted
                text = text[:cut] + (" " if cut == 0 else "-") * pad + text[cut:]
                inserted += pad
                pos += pad
            chord_row = chord_row.ljust(pos) + name
        lyric += text
    return chord_row, lyric


def to_text(blocks) -> str:
    out: list[str] = []
    for label, lines in blocks:
        if label:
            out.append(f"[{label}]")
        for kind, data in lines:
            if kind == "chords":
                out.append("  ".join(data))
            else:
                c, l = lyric_rows(data)
                if c.strip():
                    out.append(c)
                out.append(l)
        out.append("")
    return "\n".join(out).strip() + "\n"


def to_chordpro(blocks, title: str, key: str, bpm: float, time_sig: str, capo: int) -> str:
    out = [f"{{title: {title}}}", f"{{key: {key}}}", f"{{tempo: {round(bpm or 0)}}}", f"{{time: {time_sig}}}"]
    if capo:
        out.append(f"{{capo: {capo}}}")
    out.append("")
    for label, lines in blocks:
        chorus = "refr" in label.lower()
        if label:
            out.append(f"{{start_of_chorus: {label}}}" if chorus else f"{{comment: {label}}}")
        for kind, data in lines:
            if kind == "chords":
                out.append(" ".join(f"[{c}]" for c in data))
            else:
                parts = []
                for text, chords in data:
                    for off, name in sorted(chords, reverse=True):
                        text = text[:off] + f"[{name}]" + text[off:]
                    parts.append(text)
                out.append(" ".join(parts))
        if label and chorus:
            out.append("{end_of_chorus}")
        out.append("")
    return "\n".join(out)
