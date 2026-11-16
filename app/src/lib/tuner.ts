// Afinador: afinações prontas e detecção de altura (algoritmo YIN) sobre o sinal do microfone.

export interface Tuning { id: string; name: string; notes: string[] } // notas da corda mais grave para a mais aguda
export interface Instrument { id: string; name: string; tunings: Tuning[] }

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'violao', name: 'Violão / Guitarra', tunings: [
      { id: 'padrao', name: 'Padrão em Mi (E A D G B E)', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'meio-tom', name: 'Mi bemol – meio tom abaixo (Eb Ab Db Gb Bb Eb)', notes: ['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
      { id: 'um-tom', name: 'Ré – um tom abaixo (D G C F A D)', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
      { id: 'drop-d', name: 'Drop D (D A D G B E)', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'drop-db', name: 'Drop C# (C# G# C# F# A# D#)', notes: ['C#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
      { id: 'drop-c', name: 'Drop C (C G C F A D)', notes: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
      { id: 'dadgad', name: 'DADGAD (D A D G A D)', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
      { id: 'open-g', name: 'Sol aberto – Open G (D G D G B D)', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
      { id: 'open-d', name: 'Ré aberto – Open D (D A D F# A D)', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
      { id: 'open-e', name: 'Mi aberto – Open E (E B E G# B E)', notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'] },
      { id: 'open-c', name: 'Dó aberto – Open C (C G C G C E)', notes: ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'] },
    ],
  },
  {
    id: 'viola7', name: 'Violão 7 cordas', tunings: [
      { id: 'padrao-c', name: 'Padrão com 7ª em Dó (C E A D G B E)', notes: ['C2', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'padrao-b', name: 'Padrão com 7ª em Si (B E A D G B E)', notes: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    ],
  },
  {
    id: 'baixo', name: 'Baixo 4 cordas', tunings: [
      { id: 'padrao', name: 'Padrão em Mi (E A D G)', notes: ['E1', 'A1', 'D2', 'G2'] },
      { id: 'meio-tom', name: 'Mi bemol – meio tom abaixo (Eb Ab Db Gb)', notes: ['D#1', 'G#1', 'C#2', 'F#2'] },
      { id: 'drop-d', name: 'Drop D (D A D G)', notes: ['D1', 'A1', 'D2', 'G2'] },
      { id: 'um-tom', name: 'Ré – um tom abaixo (D G C F)', notes: ['D1', 'G1', 'C2', 'F2'] },
    ],
  },
  {
    id: 'baixo5', name: 'Baixo 5 cordas', tunings: [
      { id: 'padrao', name: 'Padrão (B E A D G)', notes: ['B0', 'E1', 'A1', 'D2', 'G2'] },
    ],
  },
  {
    id: 'ukulele', name: 'Ukulele', tunings: [
      { id: 'padrao', name: 'Padrão (G C E A)', notes: ['G4', 'C4', 'E4', 'A4'] },
      { id: 'baritono', name: 'Barítono (D G B E)', notes: ['D3', 'G3', 'B3', 'E4'] },
    ],
  },
  {
    id: 'cavaquinho', name: 'Cavaquinho', tunings: [
      { id: 'padrao', name: 'Padrão (D G B D)', notes: ['D4', 'G4', 'B4', 'D5'] },
    ],
  },
]

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PT: Record<string, string> = { C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' }

export function noteToMidi(n: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(n)
  if (!m) return 69
  return NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12
}
export const midiToFreq = (m: number, a4 = 440) => a4 * 2 ** ((m - 69) / 12)
export const freqToMidi = (f: number, a4 = 440) => 69 + 12 * Math.log2(f / a4)
export const noteName = (m: number) => NAMES[((Math.round(m) % 12) + 12) % 12]
export const noteOctave = (m: number) => Math.floor(Math.round(m) / 12) - 1
/** "C#" → "Dó♯" */
export function ptName(n: string) { const b = n[0]; return (PT[b] ?? b) + (n.includes('#') ? '♯' : '') }
/** "D#" → "E♭" quando a afinação é pensada em bemóis */
export function flatName(n: string) {
  const i = NAMES.indexOf(n)
  return n.includes('#') ? NAMES[(i + 1) % 12] + '♭' : n
}

/** YIN: devolve a frequência fundamental (Hz) ou null quando não há nota clara. */
export function rmsOf(buf: Float32Array) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length) }

export function detectPitch(buf: Float32Array, sr: number, minF = 28, maxF = 1400, gate = 0.002): number | null {
  if (rmsOf(buf) < gate) return null

  const tauMin = Math.max(2, Math.floor(sr / maxF))
  const tauMax = Math.min(Math.floor(sr / minF), Math.floor(buf.length / 2))
  const W = buf.length - tauMax
  const d = new Float32Array(tauMax + 1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x }
    d[tau] = s
  }
  // diferença média normalizada acumulada
  let run = 0
  d[0] = 1
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1 }

  let tau = -1
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < 0.2) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) {
    // som fraco/ruidoso: aceita o vale mais fundo se ainda for claramente periódico
    let bt = -1
    for (let t = tauMin; t <= tauMax; t++) if (bt < 0 || d[t] < d[bt]) bt = t
    if (bt > 0 && d[bt] < 0.35) tau = bt
  }
  if (tau < 0 || tau >= tauMax - 1) return null // na borda da faixa: período fora do alcance
  // interpolação parabólica
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau]
  const den = a + c - 2 * b
  const shift = den ? (a - c) / (2 * den) : 0
  return sr / (tau + shift)
}

/** MIDI → "E2" (nome com oitava, no formato das afinações acima) */
export const midiToNote = (m: number) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)
