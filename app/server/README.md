# Servidor do Josué (GPU)

Processamento pesado para qualidade máxima: **Demucs (htdemucs)** separa voz e instrumental,
**Whisper large-v3** (faster-whisper) transcreve a letra com tempo por palavra, **madmom** reconhece
acordes, batidas e compasso, e o **librosa** calcula tom (Krumhansl) e seções.

## Como ligar (com Docker e placa NVIDIA)

```bash
cd server
docker compose up --build
```

A API fica em `http://localhost:8000`. No app web, abra **Onde processar → Servidor com GPU**,
cole esse endereço e clique em **Testar**.

## Sem Docker (desenvolvimento)

```bash
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install cython "numpy<2.0" && pip install -r requirements.txt
USE_QUEUE=0 WHISPER_DEVICE=cpu WHISPER_COMPUTE=int8 DEMUCS_DEVICE=cpu uvicorn cifra_server.main:app --port 8000
```

`USE_QUEUE=0` processa numa thread do próprio servidor (sem Redis) e usa SQLite.
Em CPU, uma música de 4 min leva vários minutos; com GPU a meta é menos de 2 min.

## Endpoints

| Método | Caminho | O que faz |
|---|---|---|
| POST | `/songs` | envio (campo `file`, ou `url` do YouTube) → `{song_id, job_id}` |
| GET | `/jobs/{id}` | status, etapa (1–7) e progresso; `/jobs/{id}/events` em tempo real (SSE) |
| GET | `/songs/{id}` | `{meta:{bpm,key,time_sig,duracao}, words:[{t0,t1,texto}], chords:[{t0,t1,acorde}], sections:[{t0,t1,rotulo}]}` |
| PATCH | `/songs/{id}` | edições (título, palavras, acordes, seções); cada uma fica registrada em `edits` |
| GET | `/songs/{id}/export?format=pdf\|txt\|chordpro&transpose=n&capo=n` | exportação |
| DELETE | `/songs/{id}` | exclui |

Banco: tabelas `songs`, `jobs`, `lyrics_words`, `chords`, `sections`, `edits` (PostgreSQL no Docker).
