import type { ChordEvent, PowerSwap } from './types'
// Fila de processamento: uma música por vez, etapa por etapa (1 a 8), com progresso salvo.
import { decodeFile, renderMono } from './audio'
import { getAudio, getSong, listSongs, patchSong, putAudio, putSong } from './db'
import { getJob, getServerSong, uploadSong, chordServerAlive, chordsFromServer, separationStatus, startSeparation, startTabs, stemUrl, tabsStatus, lyricsOnServer } from './api'
import { LANG_CODES, loadSettings } from './settings'
import type { ChordEvent as CE, Song, Stems, Tabs, Word } from './types'

export const MAX_BYTES = 100 * 1024 * 1024
export const MAX_SECONDS = 20 * 60
export const ACCEPT = '.mp3,.wav,.m4a,.flac,.ogg,.aac,audio/*'

const HUES = [186, 160, 262, 32, 330, 210, 120]

export function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4) }

export async function addFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('O arquivo passa de 100 MB.')
  if (!/\.(mp3|wav|m4a|flac|ogg|aac|mp4)$/i.test(file.name) && !file.type.startsWith('audio/')) throw new Error('Formato não suportado. Use MP3, WAV, M4A ou FLAC.')
  const id = newId()
  const settings = loadSettings()
  const song: Song = {
    id,
    title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '),
    createdAt: Date.now(), updatedAt: Date.now(),
    fileName: file.name, mime: file.type, size: file.size,
    status: 'queued', step: 0, progress: 0,
    meta: { bpm: 0, key: '', timeSig: '', duration: 0 },
    words: [], chords: [], sections: [],
    engine: settings.engine,
    hue: HUES[Math.floor(Math.random() * HUES.length)],
  }
  await putAudio(id, file)
  await putSong(song)
  kick()
  return id
}

let running = false

export async function resumeQueue() {
  const songs = await listSongs()
  for (const s of songs) if (s.status === 'processing') await patchSong(s.id, { status: 'queued', step: 0, progress: 0 })
  kick()
}

export function retry(id: string) { void patchSong(id, { status: 'queued', step: 0, progress: 0, error: undefined }).then(kick) }

function kick() {
  if (running) return
  running = true
  void (async () => {
    try {
      for (;;) {
        const next = (await listSongs()).filter((s) => s.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!next) break
        try {
          if (next.engine === 'server') await processOnServer(next)
          else await processInBrowser(next)
        } catch (err) {
          await patchSong(next.id, { status: 'error', error: friendly(err) })
        }
      }
    } finally { running = false }
  })()
}

function friendly(err: unknown) {
  const m = String((err as Error)?.message ?? err)
  if (/decode|EncodingError|Unable to decode/i.test(m)) return 'Não foi possível ler este áudio. Tente outro arquivo (MP3, WAV, M4A ou FLAC).'
  if (/fetch|network|Failed to fetch/i.test(m)) return 'Falha de conexão ao baixar o modelo de IA ou falar com o servidor. Verifique a internet e tente de novo.'
  return m
}

let lastWrite = 0
function progress(id: string, step: number, p: number, label?: string) {
  const now = performance.now()
  if (p < 1 && p > 0 && now - lastWrite < 250) return
  lastWrite = now
  void patchSong(id, { status: 'processing', step, progress: Math.max(0, Math.min(1, p)), stepLabel: label })
}

async function processInBrowser(song: Song) {
  const blob = await getAudio(song.id)
  if (!blob) throw new Error('Áudio não encontrado.')
  const settings = loadSettings()
  // 1) separação de faixas (aproximada: canal central para a voz, mix completo para a harmonia)
  progress(song.id, 1, 0.05, 'Lendo o áudio')
  const buf = await decodeFile(blob)
  if (buf.duration > MAX_SECONDS) throw new Error('A música passa de 20 minutos.')
  await patchSong(song.id, { meta: { ...song.meta, duration: buf.duration } })
  const serverOn = await chordServerAlive()
  // acordes pelo modelo treinado (servidor local), em paralelo com o resto
  const btc: Promise<ChordEvent[] | null> = serverOn ? chordsFromServer(blob, song.fileName).catch(() => null) : Promise.resolve(null)

  // separação de verdade (Demucs) quando o servidor local está ligado; senão, aproximação
  let vocal: Float32Array | null = null
  let stems: Stems | undefined
  if (serverOn) {
    try {
      stems = await separateOnServer(song.id, blob, song.fileName)
      progress(song.id, 1, 0.97, 'Preparando a voz isolada')
      const vr = await fetch(stemUrl(stems.id, 'vocals'))
      if (vr.ok) vocal = await renderMono(await decodeFile(await vr.blob()), 16000, 'mix')
      await patchSong(song.id, { stems })
    } catch (err) {
      console.warn('Separação no servidor falhou; usando a aproximação do navegador.', err)
    }
  }
  if (!vocal) {
    progress(song.id, 1, 0.4, 'Isolando a voz (aproximação)')
    vocal = await renderMono(buf, 16000, 'center')
  }
  progress(song.id, 1, 0.99, 'Preparando o instrumental')
  const inst = await renderMono(buf, 22050, 'mix')
  progress(song.id, 1, 1)

  // 2) letra (Whisper)
  // no servidor local: Whisper large-v3 + alinhamento por palavra; senão, Whisper no navegador
  let words: Word[] | null = null
  if (stems) {
    try {
      progress(song.id, 2, 0, 'Transcrevendo a letra (Whisper large-v3 no servidor)')
      words = await lyricsOnServer(stems.id, { language: settings.language === 'auto' ? null : settings.language },
        (p) => progress(song.id, 2, p, p < 0.7 ? `Transcrevendo a letra (${Math.round((p / 0.7) * 100)}%)` : 'Sincronizando cada palavra'))
    } catch (err) {
      console.warn('Letra no servidor falhou; usando o navegador.', err)
    }
  }
  if (!words) {
    progress(song.id, 2, 0, 'Carregando o modelo de IA')
    words = await transcribe(vocal, settings.model, LANG_CODES[settings.language], (p, label) => progress(song.id, 2, p, label), buf.duration)
  }

  // 3-7) acordes, BPM, tom, compasso, seções
  const result = await analyze(inst, 22050, buf.duration, words, (step, p) => progress(song.id, step, p))
  progress(song.id, 3, 0.5, 'Finalizando os acordes (modelo treinado)')
  const trained = await btc
  if (trained && trained.length) result.chords = trained
  let powerSwap: PowerSwap[] | undefined
  // power chords (D5, E5…): o modelo não tem esse acorde, então conferimos a terça na guitarra separada
  try {
    progress(song.id, 3, 0.8, 'Procurando power chords na guitarra')
    const before = result.chords
    result.chords = await detectPowerChords(result.chords, stems, buf)
    powerSwap = swapsOf(before, result.chords)
  } catch (err) { console.warn('Power chords: falhou', err) }
  // 8) tablatura (guitarra e baixo), só com as faixas separadas
  let tabs: Tabs | undefined
  if (stems) {
    try { tabs = await tabsOnServer(song.id, stems.id, result.chords) } catch (err) { console.warn('Tablatura falhou', err) }
  }
  const fresh = await getSong(song.id)
  if (!fresh) return // excluída durante o processamento
  await putSong({
    ...fresh,
    status: 'ready', step: 8, progress: 1, stepLabel: undefined, updatedAt: Date.now(),
    meta: { bpm: result.bpm, key: result.key, timeSig: result.timeSig, duration: buf.duration, language: settings.language },
    words, chords: result.chords, sections: result.sections, beats: result.beats, stems, tabs, powerSwap,
  })
}

async function tabsOnServer(songId: string, sid: string, chords: CE[]): Promise<Tabs> {
  progress(songId, 8, 0.02, 'Transcrevendo as notas da guitarra e do baixo')
  await startTabs(sid, chords)
  for (;;) {
    const s = await tabsStatus(sid)
    if (s.status === 'error') throw new Error(s.error || 'Falha na tablatura')
    if (s.status === 'ready' && s.tabs) return s.tabs
    progress(songId, 8, Math.max(0.02, s.progress || 0), `Montando a tablatura (${Math.round((s.progress || 0) * 100)}%)`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

async function separateOnServer(id: string, blob: Blob, name: string): Promise<Stems> {
  progress(id, 1, 0.02, 'Enviando para separar as faixas')
  const { id: sid } = await startSeparation(blob, name)
  for (;;) {
    const s = await separationStatus(sid)
    if (s.status === 'error') throw new Error(s.error || 'Falha na separação')
    if (s.status === 'ready' && s.stems) return { id: sid, list: s.stems }
    progress(id, 1, 0.02 + 0.93 * (s.progress || 0), s.status === 'queued' ? 'Na fila para separar as faixas' : `Separando as faixas com IA (${Math.round((s.progress || 0) * 100)}%)`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

function transcribe(samples: Float32Array, model: string, language: string | null, onProgress: (p: number, label: string) => void, duration: number): Promise<Word[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
    let timer = 0
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'download') onProgress(m.progress * 0.3, `Baixando o modelo de IA (${m.mb} MB, só na primeira vez)`)
      else if (m.type === 'transcribing') {
        const start = performance.now()
        // estimativa: ~0,35× a duração no processador; o progresso real não é informado pelo modelo
        const expected = Math.max(8, duration * 0.35) * 1000
        timer = window.setInterval(() => onProgress(0.3 + 0.68 * (1 - Math.exp(-(performance.now() - start) / expected)), 'Transcrevendo a letra'), 500)
      } else if (m.type === 'chunk') { clearInterval(timer); onProgress(0.3 + 0.7 * m.progress, `Transcrevendo a letra (${Math.round(m.progress * 100)}%)`) }
      else if (m.type === 'done') { clearInterval(timer); w.terminate(); resolve(m.words) }
      else if (m.type === 'error') { clearInterval(timer); w.terminate(); reject(new Error(m.message)) }
    }
    w.onerror = (e) => { clearInterval(timer); w.terminate(); reject(new Error(e.message || 'Falha na transcrição')) }
    w.postMessage({ samples, language, model }, [samples.buffer])
  })
}

/** Passada de power chords: usa a guitarra separada (ou a faixa "outros"); sem faixas, o áudio todo. */
export async function detectPowerChords(chords: ChordEvent[], stems: Stems | undefined, mix: AudioBuffer, mode: 'power' | 'unpower' = 'power'): Promise<ChordEvent[]> {
  let src: Float32Array | null = null
  const g = stems?.list.find((x) => x.name === 'guitar') ?? stems?.list.find((x) => x.name === 'other')
  if (stems && g) {
    try { const r = await fetch(stemUrl(stems.id, g.name)); if (r.ok) src = await renderMono(await decodeFile(await r.blob()), 22050, 'mix') } catch { /* usa o áudio todo */ }
  }
  if (!src) src = await renderMono(mix, 22050, 'mix')
  const samples = src
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => { const m = e.data; if (m.type === 'done') { w.terminate(); resolve(m.chords) } else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)) } }
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Falha')) }
    w.postMessage({ samples, sr: 22050, duration: mix.duration, words: [], mode, chords }, [samples.buffer])
  })
}

/** Lista do que virou power chord (para poder voltar ao acorde normal depois). */
export function swapsOf(before: ChordEvent[], after: ChordEvent[]): PowerSwap[] | undefined {
  const s = after.map((c, i) => ({ t0: c.t0, normal: before[i]?.chord, power: c.chord })).filter((x) => x.normal && x.normal !== x.power)
  return s.length ? s : undefined
}

/** Volta X5 para X ou Xm, decidindo pela terça que soa no áudio (músicas sem registro do original). */
export async function unpowerForSong(song: Song, chords: ChordEvent[]): Promise<ChordEvent[]> {
  const blob = await getAudio(song.id)
  if (!blob) throw new Error('Áudio não encontrado.')
  return detectPowerChords(chords, song.stems, await decodeFile(blob), 'unpower')
}

/** 10. Inversões pelo baixo separado (D/F#, C/E…). Sem faixas separadas, usa o áudio todo. */
export async function bassForSong(song: Song, chords: ChordEvent[], flats: boolean): Promise<ChordEvent[]> {
  const blob = await getAudio(song.id)
  if (!blob) throw new Error('Áudio não encontrado.')
  let src: Float32Array | null = null
  const b = song.stems?.list.find((x) => x.name === 'bass')
  if (song.stems && b) {
    try { const r = await fetch(stemUrl(song.stems.id, 'bass')); if (r.ok) src = await renderMono(await decodeFile(await r.blob()), 22050, 'mix') } catch { /* usa o áudio todo */ }
  }
  if (!src) src = await renderMono(await decodeFile(blob), 22050, 'mix')
  const samples = src
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => { const m = e.data; if (m.type === 'done') { w.terminate(); resolve(m.chords) } else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)) } }
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Falha')) }
    w.postMessage({ samples, sr: 22050, duration: 0, words: [], mode: 'bass', chords, flats }, [samples.buffer])
  })
}

/** Para músicas já processadas: roda só a passada de power chords. */
export async function powerChordsForSong(song: Song, chords: ChordEvent[]): Promise<{ chords: ChordEvent[]; changed: number }> {
  const blob = await getAudio(song.id)
  if (!blob) throw new Error('Áudio não encontrado.')
  const out = await detectPowerChords(chords, song.stems, await decodeFile(blob))
  return { chords: out, changed: out.filter((c, i) => c.chord !== chords[i]?.chord).length }
}

interface AnalysisResult { bpm: number; key: string; timeSig: string; chords: Song['chords']; sections: Song['sections']; beats: number[] }

function analyze(samples: Float32Array, sr: number, duration: number, words: Word[], onProgress: (step: number, p: number) => void): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') onProgress(m.step, m.progress)
      else if (m.type === 'done') { w.terminate(); resolve(m.result) }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)) }
    }
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Falha na análise')) }
    w.postMessage({ samples, sr, duration, words }, [samples.buffer])
  })
}

async function processOnServer(song: Song) {
  const settings = loadSettings()
  if (!settings.serverUrl) throw new Error('Defina o endereço do servidor nas configurações.')
  const blob = await getAudio(song.id)
  if (!blob) throw new Error('Áudio não encontrado.')
  progress(song.id, 1, 0, 'Enviando para o servidor')
  const { song_id: serverId, job_id: jobId } = await uploadSong(settings.serverUrl, blob, song.fileName)
  await patchSong(song.id, { serverId })
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    const job = await getJob(settings.serverUrl, jobId)
    if (job.status === 'error') throw new Error(job.error || 'Erro no servidor')
    if (job.status === 'ready') break
    progress(song.id, Math.max(1, job.step), job.progress, job.step_label)
  }
  const data = await getServerSong(settings.serverUrl, serverId)
  const fresh = await getSong(song.id)
  if (!fresh) return // excluída durante o processamento
  await putSong({ ...fresh, ...data, status: 'ready', step: 8, progress: 1, stepLabel: undefined, updatedAt: Date.now() })
}
