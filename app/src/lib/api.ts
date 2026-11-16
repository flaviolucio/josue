// Cliente do servidor FastAPI (opcional). Endpoints conforme a especificação do projeto.
import type { ChordEvent, Section, SongMeta, StemInfo, Tabs, Word } from './types'

export interface ServerSong { meta: { bpm: number; key: string; time_sig: string; duracao: number; language?: string }; words: { t0: number; t1: number; texto: string }[]; chords: { t0: number; t1: number; acorde: string }[]; sections: { t0: number; t1: number; rotulo: string }[] }
export interface ServerJob { id: string; status: 'queued' | 'processing' | 'ready' | 'error'; step: number; step_label?: string; progress: number; error?: string; song_id: string }

const base = (url: string) => url.replace(/\/+$/, '')

export async function uploadSong(url: string, file: Blob, name: string): Promise<{ song_id: string; job_id: string }> {
  const fd = new FormData()
  fd.append('file', file, name)
  const r = await fetch(`${base(url)}/songs`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`Servidor respondeu ${r.status}`)
  return r.json()
}


export async function getJob(url: string, id: string): Promise<ServerJob> {
  const r = await fetch(`${base(url)}/jobs/${id}`)
  if (!r.ok) throw new Error(`Servidor respondeu ${r.status}`)
  return r.json()
}

export async function getServerSong(url: string, id: string): Promise<{ meta: SongMeta; words: Word[]; chords: ChordEvent[]; sections: Section[] }> {
  const r = await fetch(`${base(url)}/songs/${id}`)
  if (!r.ok) throw new Error(`Servidor respondeu ${r.status}`)
  const s: ServerSong = await r.json()
  return {
    meta: { bpm: s.meta.bpm, key: s.meta.key, timeSig: s.meta.time_sig, duration: s.meta.duracao, language: s.meta.language },
    words: s.words.map((w) => ({ t0: w.t0, t1: w.t1, text: w.texto })),
    chords: s.chords.map((c) => ({ t0: c.t0, t1: c.t1, chord: c.acorde })),
    sections: s.sections.map((x) => ({ t0: x.t0, t1: x.t1, label: x.rotulo })),
  }
}

export async function patchServerSong(url: string, id: string, body: { title?: string; words?: Word[]; chords?: ChordEvent[]; sections?: Section[] }) {
  await fetch(`${base(url)}/songs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: body.title,
      words: body.words?.map((w) => ({ t0: w.t0, t1: w.t1, texto: w.text })),
      chords: body.chords?.map((c) => ({ t0: c.t0, t1: c.t1, acorde: c.chord })),
      sections: body.sections?.map((s) => ({ t0: s.t0, t1: s.t1, rotulo: s.label })),
    }),
  })
}

export async function pingServer(url: string): Promise<boolean> {
  try { const r = await fetch(`${base(url)}/health`); return r.ok } catch { return false }
}

// ---------- Servidor local de acordes (modelo treinado BTC) ----------
export const CHORD_SERVER = 'http://127.0.0.1:8765'

export async function chordServerAlive(): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 1200)
    const r = await fetch(`${CHORD_SERVER}/health`, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok
  } catch { return false }
}

export async function chordsFromServer(file: Blob, name: string): Promise<ChordEvent[]> {
  const fd = new FormData()
  fd.append('file', file, name)
  const r = await fetch(`${CHORD_SERVER}/chords`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`Servidor de acordes respondeu ${r.status}`)
  const j = (await r.json()) as { chords: ChordEvent[] }
  return j.chords
}

// ---------- Separação de faixas (Demucs, servidor local) ----------
export async function startSeparation(file: Blob, name: string): Promise<{ id: string; status: string }> {
  const fd = new FormData()
  fd.append('file', file, name)
  const r = await fetch(`${CHORD_SERVER}/separate`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`Separação: servidor respondeu ${r.status}`)
  return r.json()
}

export async function separationStatus(id: string): Promise<{ status: string; progress: number; stems?: StemInfo[]; error?: string }> {
  const r = await fetch(`${CHORD_SERVER}/separate/${id}`)
  if (!r.ok) throw new Error(`Separação: servidor respondeu ${r.status}`)
  return r.json()
}

export const stemUrl = (id: string, name: string) => `${CHORD_SERVER}/stems/${id}/${name}.ogg`

// ---------- Tablatura (Basic Pitch + algoritmo de digitação, servidor local) ----------
export async function startTabs(id: string, chords: ChordEvent[], force = false): Promise<{ status: string }> {
  const r = await fetch(`${CHORD_SERVER}/tabs/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chords, force }) })
  if (!r.ok) throw new Error(`Tablatura: servidor respondeu ${r.status}`)
  return r.json()
}

export async function tabsStatus(id: string): Promise<{ status: string; progress: number; tabs?: Tabs; error?: string }> {
  const r = await fetch(`${CHORD_SERVER}/tabs/${id}`)
  if (!r.ok) throw new Error(`Tablatura: servidor respondeu ${r.status}`)
  return r.json()
}

// ---------- letra no servidor (Whisper large-v3 + alinhamento, ou alinhamento da letra colada) ----------
export async function startLyrics(sid: string, opts: { language?: string | null; text?: string }): Promise<string> {
  const r = await fetch(`${CHORD_SERVER}/lyrics/${sid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts),
  })
  if (!r.ok) throw new Error(r.status === 409 ? 'As faixas desta música ainda não foram separadas.' : `Letra: servidor respondeu ${r.status}`)
  return (await r.json()).job
}
export async function lyricsJob(key: string): Promise<{ status: string; progress: number; words?: Word[]; error?: string }> {
  const r = await fetch(`${CHORD_SERVER}/lyrics-job/${key}`)
  if (!r.ok) throw new Error(`Letra: servidor respondeu ${r.status}`)
  return r.json()
}
/** Inicia e acompanha até terminar. */
export async function lyricsOnServer(sid: string, opts: { language?: string | null; text?: string }, onProgress: (p: number) => void): Promise<Word[]> {
  const key = await startLyrics(sid, opts)
  for (;;) {
    const s = await lyricsJob(key)
    if (s.status === 'error') throw new Error(s.error || 'Falha na letra')
    if (s.status === 'ready') return s.words ?? []
    onProgress(s.progress || 0)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

// ---------- link do YouTube (baixado pelo servidor local) ----------
export const isYoutubeUrl = (u: string) => /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S+$/.test(u.trim())
/** Baixa o áudio do vídeo pelo servidor local e devolve como arquivo MP3. */
export async function youtubeToFile(url: string, onProgress: (p: number) => void): Promise<File> {
  const r = await fetch(`${CHORD_SERVER}/youtube`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
  if (!r.ok) throw new Error(r.status === 400 ? 'Esse não parece um link de vídeo do YouTube.' : `Servidor respondeu ${r.status}`)
  const { job } = await r.json()
  for (;;) {
    const s = await (await fetch(`${CHORD_SERVER}/youtube/${job}`)).json()
    if (s.status === 'error') throw new Error(s.error || 'Não consegui baixar o vídeo.')
    if (s.status === 'ready') {
      const a = await fetch(`${CHORD_SERVER}/youtube/${job}/audio.mp3`)
      if (!a.ok) throw new Error('Não consegui ler o áudio baixado.')
      const name = `${String(s.title).replace(/[\/:*?"<>|]+/g, '').trim() || 'Música do YouTube'}.mp3`
      return new File([await a.blob()], name, { type: 'audio/mpeg' })
    }
    onProgress(s.progress || 0)
    await new Promise((res) => setTimeout(res, 800))
  }
}
