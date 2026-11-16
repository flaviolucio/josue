"""Job executado pelo worker RQ (ou numa thread, sem Redis)."""
from pathlib import Path

from . import pipeline
from .models import Chord, Job, LyricWord, Section, SessionLocal, Song


def process_song(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        song = db.get(Song, job.song_id)
        audio = Path(song.audio_path)

    def report(step: int, progress: float, label: str) -> None:
        with SessionLocal() as db2:
            j = db2.get(Job, job_id)
            j.status, j.step, j.progress, j.step_label = "processing", step, float(progress), label
            db2.commit()

    try:
        report(1, 0.0, "Começando")
        result = pipeline.run(audio, report)
        with SessionLocal() as db:
            song = db.get(Song, job.song_id)
            song.bpm, song.key, song.time_sig = result["bpm"], result["key"], result["time_sig"]
            song.duration, song.language = result["duration"], result["language"]
            song.words = [LyricWord(t0=w["t0"], t1=w["t1"], text=w["text"]) for w in result["words"]]
            song.chords = [Chord(t0=c["t0"], t1=c["t1"], chord=c["chord"]) for c in result["chords"]]
            song.sections = [Section(t0=s["t0"], t1=s["t1"], label=s["label"]) for s in result["sections"]]
            j = db.get(Job, job_id)
            j.status, j.step, j.progress, j.step_label = "ready", 7, 1.0, None
            db.commit()
    except Exception as exc:  # noqa: BLE001
        with SessionLocal() as db:
            j = db.get(Job, job_id)
            j.status, j.error = "error", str(exc)[:2000]
            db.commit()
        raise
