// Importação de arquivos do Guitar Pro (.gp3, .gp4, .gp5, .gpx, .gp) e de outros formatos que o
// alphaTab lê. O arquivo original fica guardado no navegador; a tela de estudo lê dele.
import * as alphaTab from '@coderline/alphatab'
import { putAudio, putSong } from './db'
import { newId } from './pipeline'
import type { GpTrackKind, Song } from './types'

export const GP_EXT = /\.(gp3|gp4|gp5|gpx|gp)$/i
export const GP_ACCEPT = '.gp3,.gp4,.gp5,.gpx,.gp'
export const isGpFile = (f: File) => GP_EXT.test(f.name)

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']

export function trackKind(t: alphaTab.model.Track): GpTrackKind {
  if (t.staves.some((s) => s.isPercussion)) return 'bateria'
  const p = t.playbackInfo?.program ?? 25
  if (p >= 32 && p <= 39) return 'baixo'
  if (p >= 24 && p <= 31) return p <= 25 ? 'violao' : 'guitarra'
  if (p <= 7 || (p >= 16 && p <= 23) || (p >= 80 && p <= 103)) return 'teclado'
  if (p >= 52 && p <= 54) return 'voz'
  if (p >= 40 && p <= 51) return 'cordas'
  if (p >= 56 && p <= 79) return 'sopro'
  return 'outro'
}

export const KIND_LABEL: Record<GpTrackKind, string> = {
  violao: 'Violão', guitarra: 'Guitarra', baixo: 'Baixo', bateria: 'Bateria', teclado: 'Teclado',
  voz: 'Voz', cordas: 'Cordas', sopro: 'Sopro', outro: 'Outro',
}

export function parseGp(bytes: Uint8Array): alphaTab.model.Score {
  try {
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes)
  } catch {
    throw new Error('Não foi possível ler este arquivo. Ele pode estar corrompido ou ser de um formato que o Josué ainda não lê.')
  }
}

/** Duração aproximada (s), somando os compassos com as mudanças de andamento. */
function durationOf(score: alphaTab.model.Score) {
  let tempo = score.tempo || 120, sec = 0
  for (const mb of score.masterBars) {
    const auto = mb.tempoAutomations?.[0]
    if (auto?.value) tempo = auto.value
    sec += (mb.calculateDuration() / 960) * (60 / tempo)
  }
  return sec
}

export async function importGp(file: File): Promise<string> {
  if (file.size > 30 * 1024 * 1024) throw new Error('O arquivo passa de 30 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const score = parseGp(bytes)
  const mb0 = score.masterBars[0]
  const ks = Number(mb0?.keySignature ?? 0)
  const minor = Number(mb0?.keySignatureType ?? 0) === 1
  const key = ks >= -7 && ks <= 7 ? (minor ? MINOR[ks + 7] + 'm' : MAJOR[ks + 7]) : ''
  const name = file.name.replace(GP_EXT, '').replace(/[_]+/g, ' ')
  const title = [score.title, score.artist].filter(Boolean).length ? `${score.title || name}${score.artist ? ' — ' + score.artist : ''}` : name
  const id = newId()
  const song: Song = {
    id, title,
    createdAt: Date.now(), updatedAt: Date.now(),
    fileName: file.name, mime: 'application/x-guitar-pro', size: file.size,
    status: 'ready', step: 0, progress: 1,
    meta: { bpm: Math.round(score.tempo || 0), key, timeSig: mb0 ? `${mb0.timeSignatureNumerator}/${mb0.timeSignatureDenominator}` : '', duration: durationOf(score) },
    words: [], chords: [], sections: [],
    engine: 'browser',
    hue: 32,
    gp: {
      format: (GP_EXT.exec(file.name)?.[1] ?? 'gp').toUpperCase(),
      artist: score.artist || undefined,
      tracks: score.tracks.map((t) => ({ name: t.name || KIND_LABEL[trackKind(t)], kind: trackKind(t) })),
    },
  }
  await putAudio(id, file)
  await putSong(song)
  return id
}
