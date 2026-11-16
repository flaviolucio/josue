"""API do Josué (FastAPI).

POST   /songs                      envio (arquivo ou campo `url` do YouTube) -> {song_id, job_id}
GET    /songs                      biblioteca
GET    /jobs/{id}                  status/progresso
GET    /jobs/{id}/events           o mesmo em tempo real (SSE)
GET    /songs/{id}                 {meta, words, chords, sections}
GET    /songs/{id}/audio           áudio original
PATCH  /songs/{id}                 edições do usuário
DELETE /songs/{id}
GET    /songs/{id}/export?format=pdf|txt|chordpro&transpose=n&capo=n
"""
from __future__ import annotations

import asyncio
import io
import json
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import cifra, config
from .models import Chord, Edit, Job, LyricWord, Section, SessionLocal, Song, init_db
from .tasks import process_song

app = FastAPI(title="Josué", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
init_db()

ALLOWED = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}


def db() -> Session:
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def enqueue(job_id: str) -> None:
    if config.USE_QUEUE:
        from redis import Redis
        from rq import Queue
        Queue("cifra", connection=Redis.from_url(config.REDIS_URL), default_timeout=3600).enqueue(process_song, job_id)
    else:
        threading.Thread(target=process_song, args=(job_id,), daemon=True).start()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/songs")
async def create_song(file: UploadFile | None = File(None), url: str | None = Form(None), s: Session = Depends(db)) -> dict:
    if not file and not url:
        raise HTTPException(400, "Envie um arquivo de áudio ou um link.")
    song = Song(title="", file_name="", audio_path="")
    s.add(song)
    s.flush()
    folder = config.STORAGE_DIR / song.id
    folder.mkdir(parents=True, exist_ok=True)
    if file:
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED:
            raise HTTPException(415, "Formato não suportado. Use MP3, WAV, M4A ou FLAC.")
        dest = folder / f"original{ext}"
        size = 0
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_BYTES:
                    out.close()
                    shutil.rmtree(folder, ignore_errors=True)
                    raise HTTPException(413, "O arquivo passa de 100 MB.")
                out.write(chunk)
        song.file_name = file.filename or dest.name
        song.title = Path(song.file_name).stem.replace("_", " ")
    else:  # fase 2: link do YouTube
        dest = folder / "original.m4a"
        cmd = [sys.executable, "-m", "yt_dlp", "-f", "bestaudio[ext=m4a]/bestaudio", "--max-filesize", "100M",
               "--print", "title", "--no-simulate", "-o", str(dest), url]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0 or not dest.exists():
            raise HTTPException(422, "Não foi possível baixar o áudio desse link.")
        song.title = (res.stdout.strip().splitlines() or ["YouTube"])[0]
        song.file_name, song.source_url = dest.name, url
    song.audio_path = str(dest)
    job = Job(song_id=song.id)
    s.add(job)
    s.commit()
    enqueue(job.id)
    return {"song_id": song.id, "job_id": job.id, "title": song.title}


def job_dict(j: Job) -> dict:
    return {"id": j.id, "song_id": j.song_id, "status": j.status, "step": j.step, "step_label": j.step_label, "progress": j.progress, "error": j.error}


@app.get("/jobs/{job_id}")
def get_job(job_id: str, s: Session = Depends(db)) -> dict:
    j = s.get(Job, job_id)
    if not j:
        raise HTTPException(404, "Job não encontrado")
    return job_dict(j)


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    async def stream():
        last = None
        while True:
            with SessionLocal() as s:
                j = s.get(Job, job_id)
                if not j:
                    yield "event: error\ndata: {}\n\n"
                    return
                data = json.dumps(job_dict(j))
            if data != last:
                yield f"data: {data}\n\n"
                last = data
            if '"status": "ready"' in data or '"status": "error"' in data:
                return
            await asyncio.sleep(1)
    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/songs")
def list_songs(s: Session = Depends(db)) -> list[dict]:
    out = []
    for song in s.query(Song).order_by(Song.created_at.desc()).all():
        job = s.query(Job).filter(Job.song_id == song.id).order_by(Job.created_at.desc()).first()
        out.append({"id": song.id, "title": song.title, "created_at": song.created_at.isoformat(), "duracao": song.duration,
                    "key": song.key, "bpm": song.bpm, "status": job.status if job else "ready", "step": job.step if job else 7})
    return out


def song_payload(song: Song) -> dict:
    return {
        "id": song.id, "title": song.title,
        "meta": {"bpm": song.bpm, "key": song.key, "time_sig": song.time_sig, "duracao": song.duration, "language": song.language},
        "words": [{"t0": w.t0, "t1": w.t1, "texto": w.text} for w in song.words],
        "chords": [{"t0": c.t0, "t1": c.t1, "acorde": c.chord} for c in song.chords],
        "sections": [{"t0": x.t0, "t1": x.t1, "rotulo": x.label} for x in song.sections],
    }


def get_or_404(s: Session, song_id: str) -> Song:
    song = s.get(Song, song_id)
    if not song:
        raise HTTPException(404, "Música não encontrada")
    return song


@app.get("/songs/{song_id}")
def get_song(song_id: str, s: Session = Depends(db)) -> dict:
    return song_payload(get_or_404(s, song_id))


@app.get("/songs/{song_id}/audio")
def get_audio(song_id: str, s: Session = Depends(db)) -> FileResponse:
    return FileResponse(get_or_404(s, song_id).audio_path)


class WordIn(BaseModel):
    t0: float
    t1: float
    texto: str


class ChordIn(BaseModel):
    t0: float
    t1: float
    acorde: str


class SectionIn(BaseModel):
    t0: float
    t1: float
    rotulo: str


class SongPatch(BaseModel):
    title: str | None = None
    words: list[WordIn] | None = None
    chords: list[ChordIn] | None = None
    sections: list[SectionIn] | None = None


@app.patch("/songs/{song_id}")
def patch_song(song_id: str, body: SongPatch, s: Session = Depends(db)) -> dict:
    song = get_or_404(s, song_id)
    if body.title is not None:
        song.title = body.title[:300]
    if body.words is not None:
        song.words = [LyricWord(t0=w.t0, t1=w.t1, text=w.texto[:120]) for w in body.words]
    if body.chords is not None:
        song.chords = [Chord(t0=c.t0, t1=c.t1, chord=c.acorde[:24]) for c in body.chords]
    if body.sections is not None:
        song.sections = [Section(t0=x.t0, t1=x.t1, label=x.rotulo[:40]) for x in body.sections]
    s.add(Edit(song_id=song.id, payload=body.model_dump(exclude_none=True)))
    s.commit()
    return song_payload(song)


@app.delete("/songs/{song_id}")
def delete_song(song_id: str, s: Session = Depends(db)) -> dict:
    song = get_or_404(s, song_id)
    s.query(Job).filter(Job.song_id == song_id).delete()
    s.query(Edit).filter(Edit.song_id == song_id).delete()
    s.delete(song)
    s.commit()
    shutil.rmtree(config.STORAGE_DIR / song_id, ignore_errors=True)
    return {"ok": True}


@app.get("/songs/{song_id}/export")
def export(song_id: str, format: str = "txt", transpose: int = 0, capo: int = 0, s: Session = Depends(db)) -> Response:
    song = get_or_404(s, song_id)
    shift = transpose - capo
    shape_key = cifra.transpose_key(song.key or "", shift)
    flats = shape_key in cifra.FLAT_KEYS
    words = [{"t0": w.t0, "t1": w.t1, "text": w.text} for w in song.words]
    chords = [{"t0": c.t0, "t1": c.t1, "chord": cifra.transpose(c.chord, shift, flats)} for c in song.chords]
    sections = [{"t0": x.t0, "t1": x.t1, "label": x.label} for x in song.sections]
    blocks = cifra.build_lines(words, chords, sections)
    name = (song.title or "cifra").replace('"', "")
    header = f"Tom: {shape_key}   BPM: {round(song.bpm or 0)}   Compasso: {song.time_sig}" + (f"   Capotraste na {capo}ª casa" if capo else "")
    if format == "txt":
        body = f"{song.title}\n{header}\n\n{cifra.to_text(blocks)}"
        return Response(body, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}.txt"'})
    if format == "chordpro":
        body = cifra.to_chordpro(blocks, song.title, shape_key, song.bpm or 0, song.time_sig or "4/4", capo)
        return Response(body, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}.cho"'})
    if format == "pdf":
        return Response(_pdf(song.title, header, blocks), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    raise HTTPException(400, "Formato deve ser pdf, txt ou chordpro")


def _pdf(title: str, header: str, blocks) -> bytes:
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    m, y, lh = 48, h - 48, 13
    c.setFont("Helvetica-Bold", 18); c.drawString(m, y, title); y -= 20
    c.setFont("Helvetica", 10); c.setFillColor(HexColor("#5a606a")); c.drawString(m, y, header); y -= 24

    def line(text: str, font: str, color: str) -> None:
        nonlocal y
        if y < 48:
            c.showPage(); y = h - 48
        c.setFont(font, 10.5); c.setFillColor(HexColor(color)); c.drawString(m, y, text); y -= lh

    for label, lines in blocks:
        if label:
            line(label.upper(), "Helvetica-Bold", "#0096aa")
        for kind, data in lines:
            if kind == "chords":
                line("  ".join(data), "Courier-Bold", "#0096aa")
            else:
                cr, ly = cifra.lyric_rows(data)
                if cr.strip():
                    line(cr, "Courier-Bold", "#0096aa")
                line(ly, "Courier", "#19191e")
        y -= lh * 0.6
    c.save()
    return buf.getvalue()
