// Desenhos de acordes: formas conhecidas de violão + gerador de posições para o resto.
import { chordPitchClasses, parseChord, transposeChord } from './chords'

export type Instrument = 'violao' | 'ukulele' | 'teclado'
export interface Shape { frets: number[]; baseFret: number; barre?: { fret: number; from: number; to: number } }

const GUITAR_TUNING = [40, 45, 50, 55, 59, 64] // E A D G B E (MIDI)
const UKE_TUNING = [67, 60, 64, 69] // G C E A

// Formas abertas clássicas (x = -1), da corda grave para a aguda.
const KNOWN: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], F: [1, 3, 3, 2, 1, 1], G: [3, 2, 0, 0, 0, 3], A: [-1, 0, 2, 2, 2, 0], B: [-1, 2, 4, 4, 4, 2],
  Cm: [-1, 3, 5, 5, 4, 3], Dm: [-1, -1, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0], Fm: [1, 3, 3, 1, 1, 1], Gm: [3, 5, 5, 3, 3, 3], Am: [-1, 0, 2, 2, 1, 0], Bm: [-1, 2, 4, 4, 3, 2],
  C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0], G7: [3, 2, 0, 0, 0, 1], A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2],
  Am7: [-1, 0, 2, 0, 1, 0], Em7: [0, 2, 0, 0, 0, 0], Dm7: [-1, -1, 0, 2, 1, 1], Bm7: [-1, 2, 0, 2, 0, 2],
  Cmaj7: [-1, 3, 2, 0, 0, 0], Fmaj7: [-1, -1, 3, 2, 1, 0], Gmaj7: [3, 2, 0, 0, 0, 2], Dmaj7: [-1, -1, 0, 2, 2, 2], Amaj7: [-1, 0, 2, 1, 2, 0], Emaj7: [0, 2, 1, 1, 0, 0],
  Dsus4: [-1, -1, 0, 2, 3, 3], Asus4: [-1, 0, 2, 2, 3, 0], Esus4: [0, 2, 2, 2, 0, 0], Dsus2: [-1, -1, 0, 2, 3, 0], Asus2: [-1, 0, 2, 2, 0, 0], Gsus4: [3, 3, 0, 0, 1, 3],
  Cadd9: [-1, 3, 2, 0, 3, 0], Gadd9: [3, 0, 0, 2, 0, 3], 'D/F#': [2, -1, 0, 2, 3, 2], 'G/B': [-1, 2, 0, 0, 0, 3], 'C/G': [3, 3, 2, 0, 1, 0], 'C/E': [0, 3, 2, 0, 1, 0], 'Am/G': [3, 0, 2, 2, 1, 0],
}

function key(name: string) {
  const c = parseChord(name)
  if (!c) return name
  // nome normalizado com sustenidos
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return names[c.root] + c.quality + (c.bass !== null && c.bass !== c.root ? '/' + names[c.bass] : '')
}

const cache = new Map<string, Shape | null>()

// ---- afinação dos diagramas do violão (a pessoa escolhe; fica lembrada) ----
export type DiagramTuning = 'padrao' | 'meio' | 'tom' | 'dropd'
export const DIAGRAM_TUNINGS: { id: DiagramTuning; name: string }[] = [
  { id: 'padrao', name: 'Padrão (E A D G B E)' }, { id: 'meio', name: 'Meio tom abaixo (Eb)' },
  { id: 'tom', name: 'Um tom abaixo (D)' }, { id: 'dropd', name: 'Drop D (D A D G B E)' },
]
let tuning: DiagramTuning = (() => { try { return (localStorage.getItem('josue.diagTuning') as DiagramTuning) || 'padrao' } catch { return 'padrao' } })()
export const getDiagramTuning = () => tuning
export function setDiagramTuning(t: DiagramTuning) { tuning = t; try { localStorage.setItem('josue.diagTuning', t) } catch { /* */ } }

export function chordShape(name: string, inst: Exclude<Instrument, 'teclado'>): Shape | null {
  if (inst === 'violao' && tuning !== 'padrao') return tunedShape(name)
  return baseShape(name, inst)
}
/** Desenho na afinação escolhida, para o acorde SOAR como o nome. */
function tunedShape(name: string): Shape | null {
  const k = 'afin:' + tuning + ':' + key(name)
  if (cache.has(k)) return cache.get(k)!
  let s: Shape | null = null
  // afinação mais grave: o mesmo desenho soa mais grave, então usa o desenho do acorde acima
  if (tuning === 'meio') s = baseShape(transposeChord(name, 1), 'violao')
  else if (tuning === 'tom') s = baseShape(transposeChord(name, 2), 'violao')
  else if (tuning === 'dropd') {
    const c = parseChord(name)
    if (c && /^5(?!\+)/.test(c.quality)) { // power chord no Drop D: um dedo só nas 3 cordas graves
      const f = (c.root - 2 + 12) % 12
      s = { frets: [f, f, f, -1, -1, -1], baseFret: f > 3 ? f : 1, barre: f > 0 ? { fret: f, from: 0, to: 2 } : undefined }
    } else {
      const b = baseShape(name, 'violao')
      // a 6ª corda ficou um tom abaixo: apertar 2 casas a mais mantém a mesma nota
      if (b) s = b.frets[0] < 0 ? b : { ...b, frets: [b.frets[0] + 2, ...b.frets.slice(1)], barre: b.barre && b.barre.from === 0 ? undefined : b.barre }
    }
  }
  cache.set(k, s)
  return s
}

function baseShape(name: string, inst: Exclude<Instrument, 'teclado'>): Shape | null {
  const k = inst + ':' + key(name)
  if (cache.has(k)) return cache.get(k)!
  let shape: Shape | null = null
  if (inst === 'violao' && KNOWN[key(name)]) shape = fromFrets(KNOWN[key(name)])
  if (!shape && inst === 'violao') shape = powerShape(name)
  if (!shape) shape = generate(name, inst === 'violao' ? GUITAR_TUNING : UKE_TUNING)
  cache.set(k, shape)
  return shape
}

/** Power chord (X5): desenho de 3 cordas — tônica na 6ª corda (ou na 5ª), quinta e oitava; resto abafado. */
function powerShape(name: string): Shape | null {
  const c = parseChord(name)
  if (!c || !/^5(?!\+)/.test(c.quality)) return null
  const onE = (c.root - 4 + 12) % 12 // casa na 6ª corda (Mi)
  const onA = (c.root - 9 + 12) % 12 // casa na 5ª corda (Lá)
  // prefere a posição mais baixa no braço (como se toca no rock)
  if (onE <= onA || onA === 0 && onE > 7) {
    const f = onE
    return { frets: [f, f + 2, f + 2, -1, -1, -1], baseFret: f > 3 ? f : 1 }
  }
  const f = onA
  return { frets: [-1, f, f + 2, f + 2, -1, -1], baseFret: f > 3 ? f : 1 }
}

function fromFrets(frets: number[]): Shape {
  const pressed = frets.filter((f) => f > 0)
  const max = Math.max(0, ...pressed)
  const min = pressed.length ? Math.min(...pressed) : 0
  const baseFret = max > 4 ? min : 1
  // pestana: menor casa usada em 3+ cordas, cobrindo da primeira à última delas
  let barre: Shape['barre']
  if (min > 0) {
    const idx = frets.map((f, i) => (f === min ? i : -1)).filter((i) => i >= 0)
    if (idx.length >= 3 && frets.slice(idx[0]).every((f) => f >= min || f === -1) && frets.slice(idx[0]).every((f) => f !== 0)) barre = { fret: min, from: idx[0], to: idx[idx.length - 1] }
  }
  return { frets, baseFret, barre }
}

function generate(name: string, tuning: number[]): Shape | null {
  const pc = chordPitchClasses(name)
  if (!pc) return null
  const S = tuning.length
  const essentials = new Set([pc.root, ...pc.pcs.slice(0, 3)])
  let best: { frets: number[]; score: number } | null = null
  for (let base = 0; base <= 9; base++) {
    const options: number[][] = tuning.map((open) => {
      const o: number[] = [-1]
      for (let f = base === 0 ? 0 : base; f <= base + 3; f++) if (pc.pcs.includes((open + f) % 12)) o.push(f)
      if (base > 0 && pc.pcs.includes(open % 12)) o.push(0)
      return o
    })
    const cur = new Array(S).fill(-1)
    const rec = (s: number) => {
      if (s === S) { evaluate(cur.slice()); return }
      for (const f of options[s]) { cur[s] = f; rec(s + 1) }
    }
    const evaluate = (frets: number[]) => {
      const sounding = frets.map((f, i) => (f >= 0 ? (tuning[i] + f) % 12 : -1))
      const played = sounding.filter((x) => x >= 0)
      if (played.length < Math.min(S, S === 6 ? 4 : 3)) return
      // cordas abafadas só nas graves (violão), sem buracos no meio
      const firstPlayed = frets.findIndex((f) => f >= 0)
      if (frets.slice(firstPlayed).some((f) => f < 0) && S === 6) return
      if (S === 4 && frets.some((f) => f < 0)) return
      for (const e of essentials) if (!played.includes(e)) return
      if (S === 6 && sounding[firstPlayed] !== pc.bass) return
      const pressed = frets.filter((f) => f > 0)
      if (pressed.length && Math.max(...pressed) - Math.min(...pressed) > 3) return
      const minP = pressed.length ? Math.min(...pressed) : 0
      const fingers = pressed.filter((f) => f > minP).length + (pressed.some((f) => f === minP) ? 1 : 0)
      if (fingers > 4) return
      let score = played.length * 2 - fingers * 1.2 - minP * 0.6 - (frets.filter((f) => f === 0).length ? 0 : 1)
      if (S === 4 && sounding[0] !== pc.root && !played.includes(pc.root)) score -= 3
      if (!best || score > best.score) best = { frets, score }
    }
    rec(0)
  }
  return best ? fromFrets((best as { frets: number[] }).frets) : null
}

export function keyboardNotes(name: string): { midi: number[]; bass: number } | null {
  const pc = chordPitchClasses(name)
  if (!pc) return null
  // voz fechada a partir do Dó central
  const base = 60 + pc.root
  const notes = pc.pcs.map((p) => {
    let m = 60 + p
    while (m < base) m += 12
    return m
  }).sort((a, b) => a - b)
  return { midi: notes, bass: 48 + pc.bass }
}
