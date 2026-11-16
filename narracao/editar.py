"""Monta o vídeo de divulgação do Josué: uma cena por frase da narração.

Cada cena: trecho do vídeo original (src), zoom suave até o ponto de interesse (cx, cy, z)
e legenda animada. Rodar com o Python do runtime do instalador (tem o ffmpeg do imageio).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _ffmpeg() -> str:
    try:  # o runtime do Josué traz o ffmpeg do imageio
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


FF = os.environ.get("FFMPEG") or _ffmpeg()
# gravação de tela original e narração (ficam fora do Git: *.mp4 / *.wav)
VIDEO = os.environ.get("JOSUE_VIDEO") or os.path.join(HERE, "gravacao.mp4")
NARR = os.environ.get("JOSUE_NARR") or os.path.join(HERE, "narracao.wav")
WORK = os.path.join(HERE, "cenas")
OUT = os.path.join(HERE, "Josue-divulgacao.mp4")
FONT_B = "C\\:/Windows/Fonts/segoeuib.ttf"
FONT = "C\\:/Windows/Fonts/segoeui.ttf"
FONT_SERIF = "C\\:/Windows/Fonts/georgiab.ttf"
FPS = 30

# início de cada frase na narração (alinhamento forçado) + fim do áudio
STARTS = [0, 7.31, 10.61, 16.56, 24.69, 30.15, 35.7, 41.24, 45.83, 51.39, 56.02, 64.67, 70.37,
          76.56, 82.84, 86.95, 89.95, 94.76, 97.52, 100.76, 106.71, 111.75, 117.28]

# (início no vídeo original em s, centro do zoom x,y no vídeo 1920x1020, zoom final, rótulo, legenda)
SCENES = [
    (0.0,   960, 330, 1.25, "",             "Música em cifra, com inteligência artificial"),
    (8.0,   680, 528, 1.7,  "PASSO 1",      "Envie o áudio da música"),
    (14.0, 1180, 560, 1.7,  "PASSO 2",      "…ou cole um link do YouTube"),
    (75.0,  760, 520, 1.3,  "CIFRA",        "Tom, BPM, compasso e seções"),
    (30.0,  960, 560, 1.25, "TABLATURA",    "Gerada a partir da guitarra separada"),
    (38.0,  960, 560, 1.15, "TABLATURA",    "Guitarra solo e base"),
    (54.0, 1020, 560, 1.5,  "REPRODUÇÃO",   "O cursor segue nota por nota"),
    (86.0, 1650, 560, 1.6,  "ACORDES",      "O desenho de cada acorde"),
    (83.5,  960, 500, 1.45, "AFINADOR",     "Afine pelo microfone", 0.36),
    (103.0, 1000, 560, 1.25, "REPRODUÇÃO",  "O acorde da vez em destaque"),
    (99.6, 1640, 600, 1.6,  "ESTUDO",       "Metrônomo, treinos, escalas e mais", 0.5),
    (88.0,  760, 190, 1.8,  "AJUSTES",      "Tom, capotraste e velocidade"),
    (126.0, 1150, 500, 1.6, "ACORDE ATUAL", "Veja o próximo acorde antes da troca"),
    (146.6, 1640, 270, 1.8, "EXPORTAR",     "PDF, texto, ChordPro ou impressão", 0.4),
    (157.0, 1250, 420, 1.6, "INSTRUMENTOS", "Violão, ukulele ou teclado"),
    (170.0,  960, 520, 1.2, "TABLATURA",    "Acordes junto com a tablatura"),
    (209.0,  700, 380, 1.4, "POWER",        "Power chords detectados na guitarra"),
    (222.0,  700, 380, 1.3, "POWER",        "Volte ao acorde normal com um clique"),
    (232.0,  700, 430, 1.3, "MODO SIMPLES", "Só a letra, para quem canta"),
    (256.0,  960, 520, 1.5, "LETRA",        "Cole a letra e sincronize cada palavra"),
    (271.0,  960, 450, 1.3, "BIBLIOTECA",   "Busca, favoritos e backup"),
    (0.0,   960, 330, 1.15, "FINAL",        ""),
]
assert len(SCENES) == len(STARTS) - 1


def txt(path: str, s: str) -> str:
    with open(path, "w", encoding="utf-8") as f:
        f.write(s)
    return path.replace("\\", "/").replace(":", "\\:")


def scene(i: int) -> str:
    src, cx, cy, z, label, caption, *rest = SCENES[i]
    speed = rest[0] if rest else 1.0  # < 1: câmera lenta (momentos que passam rápido no original)
    dur = STARTS[i + 1] - STARTS[i]
    out = os.path.join(WORK, f"c{i:02d}.mp4")
    # tira a barra de título do Windows (30 px), 1920x990 -> 2095x1080 e corta 87 px de cada lado
    k = 1080 / 990
    cx2, cy2 = (cx * k - 87) * 2, ((cy - 30) * k) * 2  # *2: o zoompan roda em 3840x2160
    # zoom com easing (suave) no primeiro 1,4 s e depois um leve avanço contínuo
    ease = "(1-pow(1-min(1,on/(1.4*30)),3))"
    zexpr = f"1+({z}-1)*{ease}+0.0006*on"
    xexpr = f"max(0,min(iw-iw/zoom,{cx2:.0f}-iw/zoom/2))"
    # o alvo fica um pouco acima do centro, para a legenda (embaixo) não cobrir
    yexpr = f"max(0,min(ih-ih/zoom,{cy2:.0f}-ih/zoom*0.4))"
    vf = [
        f"setpts=PTS/{speed}", f"fps={FPS}", "crop=1920:990:0:30", "scale=2095:1080:flags=lanczos", "crop=1920:1080",
        # zoompan em 2x para o movimento não "tremer"
        "scale=3840:2160:flags=bicubic",
        f"zoompan=z='{zexpr}':x='{xexpr}':y='{yexpr}':d=1:s=1920x1080:fps={FPS}",
    ]
    if label == "FINAL":
        vf += [
            "boxblur=18:2", "eq=brightness=-0.42:saturation=0.7",
            f"drawtext=fontfile='{FONT_SERIF}':textfile='{txt(os.path.join(WORK, 'f1.txt'), 'JOSUÉ')}':fontsize=170:fontcolor=0xF6B93B"
            ":shadowcolor=black@0.6:shadowx=0:shadowy=4"
            f":x=(w-tw)/2:y=h/2-170:alpha='min(1,t/0.6)'",
            f"drawtext=fontfile='{FONT_B}':textfile='{txt(os.path.join(WORK, 'f2.txt'), 'Estude, toque e evolua na música')}':fontsize=60:fontcolor=white"
            f":x=(w-tw)/2:y=h/2+20:alpha='min(1,max(0,(t-0.5)/0.6))'",
            f"drawtext=fontfile='{FONT}':textfile='{txt(os.path.join(WORK, 'f3.txt'), 'com praticidade')}':fontsize=46:fontcolor=0xFFD36B"
            f":x=(w-tw)/2:y=h/2+105:alpha='min(1,max(0,(t-1.0)/0.6))'",
            f"fade=out:st={dur - 0.6:.2f}:d=0.6",
        ]
    elif caption:
        # legenda: barra dourada + rótulo + frase, entra deslizando da esquerda
        slide = "(1-pow(1-min(1,max(0,(t-0.3)/0.5)),3))"
        x0 = f"80-60*(1-{slide})"
        a = f"min(1,max(0,(t-0.3)/0.4))*min(1,max(0,({dur:.2f}-t)/0.3))"
        if label:
            vf.append(
                f"drawbox=x=72:y=ih-200:w=8:h=118:color=0xF6B93B@1:t=fill:enable='between(t,0.35,{dur - 0.2:.2f})'")
            vf.append(
                f"drawtext=fontfile='{FONT_B}':textfile='{txt(os.path.join(WORK, f'l{i}.txt'), label)}':fontsize=30:fontcolor=0xF6B93B"
                f":x='{x0}+18':y=h-196:alpha='{a}':box=1:boxcolor=0x0A1324@0.85:boxborderw=12")
        vf.append(
            f"drawtext=fontfile='{FONT_B}':textfile='{txt(os.path.join(WORK, f't{i}.txt'), caption)}':fontsize=54:fontcolor=white"
            f":x='{x0}+18':y=h-136:alpha='{a}':box=1:boxcolor=0x0A1324@0.85:boxborderw=16:shadowcolor=black@0.5:shadowx=2:shadowy=2")
        if i == 0:
            vf.append("fade=in:st=0:d=0.6")
    cmd = [FF, "-y", "-loglevel", "error", "-ss", f"{src}", "-t", f"{dur * speed + 0.1:.3f}", "-i", VIDEO,
           "-vf", ",".join(vf), "-af", f"apad,volume={0.12 if speed == 1 else 0},afade=in:d=0.3,afade=out:st={max(0, dur - 0.3):.2f}:d=0.3",
           "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-ar", "48000", "-ac", "2", "-t", f"{dur:.3f}", out]
    subprocess.run(cmd, check=True)
    return out


def main():
    os.makedirs(WORK, exist_ok=True)
    only = [int(a) for a in sys.argv[1:]]
    parts = []
    for i in range(len(SCENES)):
        if only and i not in only:
            parts.append(os.path.join(WORK, f"c{i:02d}.mp4"))
            continue
        print("cena", i, flush=True)
        parts.append(scene(i))
    lst = os.path.join(WORK, "lista.txt")
    with open(lst, "w", encoding="utf-8") as f:
        f.writelines(f"file '{p}'\n" for p in parts)
    # junta as cenas e mistura a narração por cima do som ambiente
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", NARR,
                    "-filter_complex", "[1:a]aresample=48000,volume=1.0[v];[0:a][v]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT], check=True)
    print("pronto:", OUT)


if __name__ == "__main__":
    main()
