"""Servidor local do Josué: acordes (modelo treinado BTC) e separação de faixas (Demucs).

Iniciar:  .venv\\Scripts\\python.exe chords_server.py   (ou iniciar-josue.bat)
Escuta em http://127.0.0.1:8765 . O app (modo "Neste navegador") usa este servidor
automaticamente quando ele está ligado.

Endpoints
  GET  /health
  POST /chords                 arquivo -> {chords:[{t0,t1,chord}], duration}
  POST /separate               arquivo -> {id, status}   (inicia ou reaproveita a separação)
  GET  /separate/{id}          -> {status: queued|processing|ready|error, progress, stems?, error?}
  GET  /stems/{id}/{nome}.ogg  -> áudio da faixa
  POST /tabs/{id}              {chords?, force?} -> {status}   (gera a tablatura a partir das faixas)
  GET  /tabs/{id}              -> {status, progress, tabs?, error?}
"""
import hashlib
import json
import os
import queue
import re
import shutil
import tempfile
import threading
import traceback

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from chords_btc import _load, recognize

HERE = os.path.dirname(os.path.abspath(__file__))
# dados (faixas separadas, downloads): pasta do usuário na versão instalada
DATA_ROOT = os.environ.get("JOSUE_DATA") or os.path.join(HERE, "data")
DATA = os.path.join(DATA_ROOT, "stems")
os.makedirs(DATA, exist_ok=True)

LOCAL_ORIGIN = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
LOCAL_ORIGIN_RE = re.compile(LOCAL_ORIGIN)
MAX_UPLOAD = 110 * 1024 * 1024  # o app limita a 100 MB; folga para o envio multipart

app = FastAPI(title="Josué - servidor local")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=LOCAL_ORIGIN,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def only_local_pages(request, call_next):
    """O CORS não barra envios de formulário; aqui recusamos qualquer escrita vinda de outro site."""
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin is not None and not LOCAL_ORIGIN_RE.match(origin):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "origem não permitida"}, status_code=403)
    return await call_next(request)
_chord_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_queue: "queue.Queue[tuple[str, str]]" = queue.Queue()
ID_RE = re.compile(r"^[0-9a-f]{40}$")
NAME_RE = re.compile(r"^[a-z]+$")


def _save_upload(file: UploadFile, dest_dir: str) -> tuple[str, str]:
    """Grava o upload e devolve (caminho, sha1)."""
    suffix = (os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3").lower()
    if not re.match(r"^\.[a-z0-9]{2,5}$", suffix):
        suffix = ".mp3"
    path = os.path.join(dest_dir, "audio" + suffix)
    h = hashlib.sha1()
    size = 0
    with open(path, "wb") as f:
        while chunk := file.file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                raise HTTPException(413, "O arquivo passa de 100 MB.")
            h.update(chunk)
            f.write(chunk)
    return path, h.hexdigest()


@app.get("/health")
def health():
    return {"ok": True, "model": "BTC-ISMIR19 large vocabulary", "separation": "htdemucs_6s"}


@app.post("/chords")
def chords(file: UploadFile = File(...)):
    tmpdir = tempfile.mkdtemp(prefix="josue-")
    try:
        path, _ = _save_upload(file, tmpdir)
        with _chord_lock:  # um processamento por vez (CPU)
            events, length = recognize(path, simple=False)
        return {"chords": events, "duration": length}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------- separação de faixas ----------
def _manifest(sid: str):
    p = os.path.join(DATA, sid, "stems.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return None


def _worker():
    from separate import separate

    while True:
        sid, path = _queue.get()
        job = _jobs[sid]
        job["status"] = "processing"
        out = os.path.join(DATA, sid)
        try:
            def prog(p):
                job["progress"] = round(float(p), 3)

            stems = separate(path, out, on_progress=prog)
            with open(os.path.join(out, "stems.json"), "w", encoding="utf-8") as f:
                json.dump(stems, f, ensure_ascii=False)
            job.update(status="ready", progress=1.0, stems=stems)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            job.update(status="error", error=str(e))
            shutil.rmtree(out, ignore_errors=True)
        finally:
            shutil.rmtree(os.path.dirname(path), ignore_errors=True)
            _queue.task_done()


threading.Thread(target=_worker, daemon=True).start()


@app.post("/separate")
def separate_start(file: UploadFile = File(...)):
    tmpdir = tempfile.mkdtemp(prefix="josue-sep-")
    try:
        path, sid = _save_upload(file, tmpdir)
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
    if _manifest(sid) is not None:  # já separado antes: reaproveita
        shutil.rmtree(tmpdir, ignore_errors=True)
        return {"id": sid, "status": "ready"}
    job = _jobs.get(sid)
    if job and job["status"] in ("queued", "processing"):
        shutil.rmtree(tmpdir, ignore_errors=True)
        return {"id": sid, "status": job["status"]}
    _jobs[sid] = {"status": "queued", "progress": 0.0}
    _queue.put((sid, path))
    return {"id": sid, "status": "queued"}


@app.get("/separate/{sid}")
def separate_status(sid: str):
    if not ID_RE.match(sid):
        raise HTTPException(400, "id inválido")
    m = _manifest(sid)
    if m is not None:
        return {"status": "ready", "progress": 1.0, "stems": m}
    job = _jobs.get(sid)
    if not job:
        raise HTTPException(404, "separação não encontrada")
    return job


@app.get("/stems/{sid}/{name}.ogg")
def stem_file(sid: str, name: str):
    if not ID_RE.match(sid) or not NAME_RE.match(name):
        raise HTTPException(400, "inválido")
    p = os.path.join(DATA, sid, f"{name}.ogg")
    if not os.path.exists(p):
        raise HTTPException(404, "faixa não encontrada")
    return FileResponse(p, media_type="audio/ogg")


# ---------- tablatura ----------
_tab_jobs: dict[str, dict] = {}
_tab_lock = threading.Lock()


def _tabs_path(sid: str):
    return os.path.join(DATA, sid, "tabs.json")


def _run_tabs(sid: str, chords):
    from tabs import build_tabs

    job = _tab_jobs[sid]
    try:
        with _tab_lock:  # uma tablatura por vez (CPU)
            job["status"] = "processing"
            res = build_tabs(os.path.join(DATA, sid), _manifest(sid), on_progress=lambda p: job.update(progress=round(p, 3)), chords=chords)
        with open(_tabs_path(sid), "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        job.update(status="ready", progress=1.0)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        job.update(status="error", error=str(e))


@app.post("/tabs/{sid}")
def tabs_start(sid: str, body: dict = Body(default={})):
    if not ID_RE.match(sid):
        raise HTTPException(400, "id inválido")
    if _manifest(sid) is None:
        raise HTTPException(409, "separe as faixas primeiro")
    force = bool(body.get("force"))
    if os.path.exists(_tabs_path(sid)) and not force:
        return {"status": "ready"}
    job = _tab_jobs.get(sid)
    if job and job["status"] in ("queued", "processing"):
        return {"status": job["status"]}
    chords = [c for c in (body.get("chords") or []) if isinstance(c, dict) and "chord" in c][:5000]
    _tab_jobs[sid] = {"status": "queued", "progress": 0.0}
    threading.Thread(target=_run_tabs, args=(sid, chords), daemon=True).start()
    return {"status": "queued"}


@app.get("/tabs/{sid}")
def tabs_status(sid: str):
    if not ID_RE.match(sid):
        raise HTTPException(400, "id inválido")
    job = _tab_jobs.get(sid)
    if job and job["status"] in ("queued", "processing", "error"):
        return job
    p = _tabs_path(sid)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return {"status": "ready", "progress": 1.0, "tabs": json.load(f)}
    raise HTTPException(404, "tablatura não encontrada")


# ---------- letra (Whisper large-v3 + alinhamento, ou só alinhamento da letra colada) ----------
_lyr_jobs: dict[str, dict] = {}


def _run_lyrics(key: str, sid: str, language, text):
    import lyrics

    job = _lyr_jobs[key]
    try:
        job["status"] = "processing"
        words = lyrics.run(os.path.join(DATA, sid, "vocals.ogg"), language, text, on_progress=lambda p: job.update(progress=round(p, 3)))
        job.update(status="ready", progress=1.0, words=words)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        job.update(status="error", error=str(e))


@app.post("/lyrics/{sid}")
def lyrics_start(sid: str, body: dict = Body(default={})):
    if not ID_RE.match(sid):
        raise HTTPException(400, "id inválido")
    if not os.path.exists(os.path.join(DATA, sid, "vocals.ogg")):
        raise HTTPException(409, "separe as faixas primeiro")
    text = body.get("text") or None
    if text is not None:
        text = str(text)[:20000]
    lang = body.get("language") or None
    if lang is not None and not re.match(r"^[a-z]{2}$", str(lang)):
        lang = None
    key = hashlib.sha1(f"{sid}|{lang}|{text or ''}".encode()).hexdigest()
    job = _lyr_jobs.get(key)
    if not job or job["status"] == "error":
        _lyr_jobs[key] = {"status": "queued", "progress": 0.0}
        threading.Thread(target=_run_lyrics, args=(key, sid, lang, text), daemon=True).start()
    return {"job": key, "status": _lyr_jobs[key]["status"]}


@app.get("/lyrics-job/{key}")
def lyrics_status(key: str):
    if not ID_RE.match(key):
        raise HTTPException(400, "id inválido")
    job = _lyr_jobs.get(key)
    if not job:
        raise HTTPException(404, "não encontrado")
    return job


# ---------- link do YouTube -> áudio (yt-dlp + ffmpeg do imageio-ffmpeg) ----------
YT_RE = re.compile(r"^https?://(www\.|m\.|music\.)?(youtube\.com/(watch\?|shorts/|live/|embed/)|youtu\.be/)[^\s]+$")
YT_DIR = os.path.join(DATA_ROOT, "youtube")
os.makedirs(YT_DIR, exist_ok=True)
_yt_jobs: dict[str, dict] = {}


def _run_youtube(key: str, url: str):
    import imageio_ffmpeg
    import yt_dlp

    job = _yt_jobs[key]
    out = os.path.join(YT_DIR, key)
    os.makedirs(out, exist_ok=True)

    def hook(d):
        if d.get("status") == "downloading":
            tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if tot:
                job["progress"] = round(0.9 * d.get("downloaded_bytes", 0) / tot, 3)
        elif d.get("status") == "finished":
            job["progress"] = 0.92

    opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "outtmpl": os.path.join(out, "audio.%(ext)s"),
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
        "max_filesize": 100 * 1024 * 1024,
        "match_filter": yt_dlp.utils.match_filter_func("duration <= 1200"),  # até 20 min
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
    }
    try:
        job["status"] = "processing"
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        path = os.path.join(out, "audio.mp3")
        if not os.path.exists(path):
            raise RuntimeError("o vídeo foi recusado (passa de 20 minutos, é privado ou está bloqueado)")
        job.update(status="ready", progress=1.0, title=(info or {}).get("title") or "Música do YouTube", path=path)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        msg = str(e)
        if "Private" in msg or "private" in msg:
            msg = "o vídeo é privado"
        elif "Sign in" in msg or "age" in msg:
            msg = "o YouTube pede login para este vídeo (restrição de idade)"
        job.update(status="error", error=f"Não consegui baixar: {msg[:300]}")
        shutil.rmtree(out, ignore_errors=True)


@app.post("/youtube")
def youtube_start(body: dict = Body(default={})):
    url = str(body.get("url") or "").strip()
    if not YT_RE.match(url) or len(url) > 300:
        raise HTTPException(400, "link do YouTube inválido")
    key = hashlib.sha1(url.encode()).hexdigest()
    job = _yt_jobs.get(key)
    if not job or job["status"] == "error":
        _yt_jobs[key] = {"status": "queued", "progress": 0.0}
        threading.Thread(target=_run_youtube, args=(key, url), daemon=True).start()
    return {"job": key}


@app.get("/youtube/{key}")
def youtube_status(key: str):
    if not ID_RE.match(key) or key not in _yt_jobs:
        raise HTTPException(404, "não encontrado")
    j = _yt_jobs[key]
    return {k: v for k, v in j.items() if k != "path"}


@app.get("/youtube/{key}/audio.mp3")
def youtube_audio(key: str):
    j = _yt_jobs.get(key) if ID_RE.match(key) else None
    if not j or j.get("status") != "ready":
        raise HTTPException(404, "não encontrado")
    return FileResponse(j["path"], media_type="audio/mpeg")


def _update_ytdlp():
    """O YouTube muda com frequência; mantém o yt-dlp atualizado a cada início do servidor."""
    import subprocess
    import sys

    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "yt-dlp"], timeout=180, capture_output=True)
    except Exception:  # noqa: BLE001
        pass


# ---------- compartilhar PDF com a banda (QR Code na rede local) ----------
# O app (neste computador) envia o PDF para /share; os celulares na mesma rede Wi-Fi baixam por
# uma porta SEPARADA (8766) que só entrega esses PDFs — o resto do servidor continua só local.
SHARE = os.path.join(DATA_ROOT, "share")
SHARE_PORT = 8766
SHARE_ID = re.compile(r"^[0-9a-f]{12}$")


def lan_ip() -> str:
    import socket

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # não envia nada; só descobre a placa de rede usada
        return s.getsockname()[0]
    except Exception:  # noqa: BLE001
        return "127.0.0.1"
    finally:
        s.close()


@app.post("/share")
def share_pdf(file: UploadFile = File(...)):
    os.makedirs(SHARE, exist_ok=True)
    data = file.file.read(50 * 1024 * 1024 + 1)
    if len(data) > 50 * 1024 * 1024 or not data.startswith(b"%PDF"):
        raise HTTPException(400, "Envie um PDF de até 50 MB.")
    sid = hashlib.sha1(data).hexdigest()[:12]
    with open(os.path.join(SHARE, sid + ".pdf"), "wb") as f:
        f.write(data)
    # guarda só os 30 mais recentes
    files = sorted((os.path.join(SHARE, n) for n in os.listdir(SHARE)), key=os.path.getmtime)
    for old in files[:-30]:
        try:
            os.remove(old)
        except OSError:
            pass
    name = re.sub(r"[^\w\-. ]+", "", file.filename or "repertorio.pdf").strip() or "repertorio.pdf"
    from urllib.parse import quote

    return {"url": f"http://{lan_ip()}:{SHARE_PORT}/s/{sid}/{quote(name)}", "ip": lan_ip()}


share_app = FastAPI(title="Josué - PDFs compartilhados")


@share_app.get("/s/{sid}/{name}")
def shared(sid: str, name: str):
    path = os.path.join(SHARE, sid + ".pdf")
    if not SHARE_ID.match(sid) or not os.path.isfile(path):
        raise HTTPException(404, "Este PDF não está mais disponível.")
    return FileResponse(path, media_type="application/pdf", filename=name if name.endswith(".pdf") else "repertorio.pdf")


def _serve_share():
    import uvicorn

    try:
        uvicorn.run(share_app, host="0.0.0.0", port=SHARE_PORT, log_level="warning")
    except Exception as e:  # noqa: BLE001
        print("Compartilhamento na rede local indisponível:", e)


# ---------- a própria tela do app (versão instalada: um programa só, sem Node.js) ----------
WEB = os.environ.get("JOSUE_WEB") or os.path.join(HERE, "..", "dist")
if os.path.isdir(WEB):
    import mimetypes

    from fastapi.staticfiles import StaticFiles

    # Em alguns Windows o registro diz que ".js" é "text/plain" e o navegador recusa os módulos do app.
    # Fixa os tipos certos aqui, independente do computador.
    for ext, kind in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"), (".wasm", "application/wasm"),
                      (".json", "application/json"), (".svg", "image/svg+xml"), (".webp", "image/webp"), (".woff2", "font/woff2"),
                      (".woff", "font/woff"), (".otf", "font/otf"), (".sf2", "application/octet-stream")):
        mimetypes.add_type(kind, ext)
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")


def serve(port: int = 8765):
    import uvicorn

    print("Carregando o modelo de acordes...")
    _load(True)
    threading.Thread(target=_update_ytdlp, daemon=True).start()
    threading.Thread(target=_serve_share, daemon=True).start()
    print(f"Pronto: http://127.0.0.1:{port}  (feche esta janela para desligar)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    serve()
