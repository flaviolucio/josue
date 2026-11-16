export interface Word { t0: number; t1: number; text: string; /** nº da linha quando a letra foi colada (as quebras de linha seguem o texto) */ line?: number }
export interface ChordEvent { t0: number; t1: number; chord: string }
export interface Section { t0: number; t1: number; label: string }

export interface SongMeta {
  bpm: number
  key: string
  timeSig: string
  duration: number
  language?: string
}

export interface StemInfo { name: string; label: string; rms: number }
export interface Stems { id: string; list: StemInfo[] }

export interface TabNote { t0: number; t1: number; pitch: number; vel: number; string: number; fret: number; q0: number; qd: number; role: 'base' | 'solo' }
export interface TabTrack { id: 'guitar' | 'bass' | string; name: string; tuning: number[]; notes: TabNote[] }
export interface Tabs { bpm: number; beats: number[]; grid: number; tracks: TabTrack[] }

export type SongStatus = 'queued' | 'processing' | 'ready' | 'error'

export interface Song {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  fileName: string
  mime: string
  size: number
  status: SongStatus
  step: number // 0..7
  stepLabel?: string
  progress: number // 0..1 da etapa atual
  error?: string
  meta: SongMeta
  words: Word[]
  chords: ChordEvent[]
  sections: Section[]
  beats?: number[]
  stems?: Stems
  tabs?: Tabs
  engine: 'browser' | 'server'
  serverId?: string
  demo?: boolean
  hue: number
  /** tablatura importada de um arquivo do Guitar Pro (o arquivo fica guardado no lugar do áudio) */
  gp?: { format: string; artist?: string; tracks: { name: string; kind: GpTrackKind }[] }
  favorite?: boolean
  /** acordes trocados por power chord (para ligar/desligar sem perder o original) */
  powerSwap?: PowerSwap[]
  /** anotações do músico por linha da cifra */
  notes?: { t0: number; text: string }[]
  lastOpenedAt?: number
}

export type GpTrackKind = 'violao' | 'guitarra' | 'baixo' | 'bateria' | 'teclado' | 'voz' | 'cordas' | 'sopro' | 'outro'

export const STEPS = [
  'Separação de faixas',
  'Transcrição da letra',
  'Detecção de acordes',
  'BPM e batidas',
  'Tonalidade',
  'Compasso',
  'Seções',
  'Tablatura',
] as const

export const SECTION_LABELS = ['Intro', 'Verso', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Instrumental', 'Final']

/** Repertório (setlist): músicas em ordem, cada uma com o tom em que será tocada */
export interface SetlistItem { songId: string; semis: number; capo?: number; singer?: string }
export interface Setlist { id: string; name: string; date?: string; notes?: string; items: SetlistItem[]; createdAt: number; updatedAt: number }

export interface PowerSwap { t0: number; normal: string; power: string }
