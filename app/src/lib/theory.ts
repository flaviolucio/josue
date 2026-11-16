// Teoria musical para o músico: graus (I–IV–V), escalas, capo inteligente, posições alternativas
// dos acordes (com condução de vozes), som de um acorde, dificuldade das trocas e compassos.
import { chordPitchClasses, isMinorQuality, parseChord, simplifyChord, transposeChord } from './chords'
import { chordShape, type Shape } from './diagrams'
import type { ChordEvent } from './types'

// ---------- 8. graus ----------
const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII']
/** "Em" em Sol -> "vi"; "D7" -> "V7"; "Bm7(b5)" -> "viiø" */
export function degreeOf(chord: string, key: string): string {
  const c = parseChord(chord), k = parseChord(key || '')
  if (!c || !k) return chord
  const iv = (c.root - k.root + 12) % 12
  let r = ROMAN[iv]
  const q = c.quality
  if (/^5/.test(q)) return r + '5'
  const minor = isMinorQuality(q)
  if (minor) r = r.replace(/[IV]+/, (m) => m.toLowerCase())
  let rest = q
  if (/^(dim|°)/.test(q)) rest = '°' + q.replace(/^(dim|°)/, '')
  else if (/m7\(?b5|ø/.test(q)) rest = 'ø'
  else if (minor) rest = q.replace(/^(m(?!aj)|min|-)/, '')
  const bass = c.bass !== null && c.bass !== c.root ? '/' + ROMAN[(c.bass - k.root + 12) % 12] : ''
  return r + rest + bass
}

// ---------- 9. escalas ----------
export const SCALES: Record<string, { name: string; iv: number[] }> = {
  pentaMenor: { name: 'Pentatônica menor', iv: [0, 3, 5, 7, 10] },
  pentaMaior: { name: 'Pentatônica maior', iv: [0, 2, 4, 7, 9] },
  blues: { name: 'Blues', iv: [0, 3, 5, 6, 7, 10] },
  maior: { name: 'Maior (jônio)', iv: [0, 2, 4, 5, 7, 9, 11] },
  menor: { name: 'Menor natural (eólio)', iv: [0, 2, 3, 5, 7, 8, 10] },
  harmonica: { name: 'Menor harmônica', iv: [0, 2, 3, 5, 7, 8, 11] },
}
export function keyInfo(key: string) {
  const k = parseChord(key || 'C')
  return { root: k?.root ?? 0, minor: !!k && isMinorQuality(k.quality) }
}

// ---------- 5. capo inteligente ----------
const OPEN = new Set(['C', 'D', 'E', 'G', 'A', 'Am', 'Em', 'Dm', 'C7', 'D7', 'E7', 'G7', 'A7', 'B7', 'Am7', 'Em7', 'Dm7', 'C7M', 'G7M', 'D7M', 'A7M', 'E7M', 'F7M', 'Dsus4', 'Asus4', 'Esus4', 'Dsus2', 'Asus2', 'Cadd9', 'Gadd9', 'E5', 'A5', 'D5', 'G5', 'Em9', 'Bm7'])
/** Melhor casa de capo para o tom em que a música vai soar: mais tempo com acordes abertos. */
export function bestCapo(chords: ChordEvent[], semis: number): { capo: number; shapeKey: number; openShare: number }[] {
  const total = chords.reduce((a, c) => a + (c.t1 - c.t0), 0) || 1
  const out = []
  for (let capo = 0; capo <= 7; capo++) {
    let open = 0
    for (const c of chords) {
      const t = transposeChord(c.chord, semis - capo, false).replace(/\/.*$/, '')
      const base = t.replace(/maj7/, '7M')
      if (OPEN.has(base) || OPEN.has(simplifyChord(base, false))) open += c.t1 - c.t0
    }
    out.push({ capo, shapeKey: semis - capo, openShare: open / total })
  }
  return out.sort((a, b) => b.openShare - a.openShare || a.capo - b.capo)
}

// ---------- 4. posições alternativas ----------
// formas móveis (CAGED), da corda grave para a aguda; -1 = abafada. A 1ª casa usada é a da tônica.
const FORMS: Record<string, { str: number; frets: number[] }[]> = {
  M: [{ str: 0, frets: [0, 2, 2, 1, 0, 0] }, { str: 1, frets: [-1, 0, 2, 2, 2, 0] }, { str: 2, frets: [-1, -1, 0, 2, 3, 2] }],
  m: [{ str: 0, frets: [0, 2, 2, 0, 0, 0] }, { str: 1, frets: [-1, 0, 2, 2, 1, 0] }, { str: 2, frets: [-1, -1, 0, 2, 3, 1] }],
  '7': [{ str: 0, frets: [0, 2, 0, 1, 0, 0] }, { str: 1, frets: [-1, 0, 2, 0, 2, 0] }, { str: 2, frets: [-1, -1, 0, 2, 1, 2] }],
  m7: [{ str: 0, frets: [0, 2, 0, 0, 0, 0] }, { str: 1, frets: [-1, 0, 2, 0, 1, 0] }, { str: 2, frets: [-1, -1, 0, 2, 1, 1] }],
  '7M': [{ str: 0, frets: [0, -1, 1, 1, 0, -1] }, { str: 1, frets: [-1, 0, 2, 1, 2, 0] }, { str: 2, frets: [-1, -1, 0, 2, 2, 2] }],
  '5': [{ str: 0, frets: [0, 2, 2, -1, -1, -1] }, { str: 1, frets: [-1, 0, 2, 2, -1, -1] }],
}
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4] // E A D G B E (classe de altura)

function formKey(q: string) {
  if (/^5(?!\+)/.test(q)) return '5'
  if (/^(7M|maj7)$/.test(q)) return '7M'
  if (/^m7$/.test(q)) return 'm7'
  if (/^7$/.test(q)) return '7'
  if (/^(m|min)$/.test(q)) return 'm'
  if (q === '') return 'M'
  return null
}
function toShape(frets: number[]): Shape {
  const pressed = frets.filter((f) => f > 0)
  const min = pressed.length ? Math.min(...pressed) : 0
  const max = Math.max(0, ...pressed)
  const baseFret = max > 4 ? min : 1
  let barre: Shape['barre']
  if (min > 0) {
    const idx = frets.map((f, i) => (f === min ? i : -1)).filter((i) => i >= 0)
    if (idx.length >= 2 && frets.slice(idx[0], idx[idx.length - 1] + 1).every((f) => f >= min || f === -1)) barre = { fret: min, from: idx[0], to: idx[idx.length - 1] }
  }
  return { frets, baseFret, barre }
}
/** Até 4 desenhos do acorde no violão (o padrão + formas com pestana pelo braço). */
export function voicings(name: string): Shape[] {
  const out: Shape[] = []
  const add = (s: Shape | null) => { if (s && !out.some((o) => o.frets.join() === s.frets.join())) out.push(s) }
  add(chordShape(name, 'violao'))
  const c = parseChord(name)
  const fk = c ? formKey(c.quality) : null
  if (c && fk && (c.bass === null || c.bass === c.root)) {
    for (const f of FORMS[fk]) {
      let off = (c.root - OPEN_STRINGS[f.str] + 12) % 12
      if (off === 0) off = 12 // forma aberta já é o desenho padrão; mostra a da 12ª casa só se fizer sentido
      if (off > 12) continue
      const frets = f.frets.map((x) => (x < 0 ? -1 : x + off))
      if (Math.max(...frets) <= 15) add(toShape(frets))
    }
  }
  return out.sort((a, b) => center(a) - center(b)).slice(0, 5)
}
const center = (s: Shape) => { const p = s.frets.filter((f) => f > 0); return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0 }
/** Desenho mais perto do anterior (menos movimento da mão). */
export function closestVoicing(options: Shape[], prev: Shape | null): number {
  if (!prev || options.length < 2) return 0
  const pc = center(prev)
  let best = 0
  options.forEach((o, i) => { if (Math.abs(center(o) - pc) < Math.abs(center(options[best]) - pc)) best = i })
  return best
}

// ---------- som de um acorde (dicionário e treino de ouvido) ----------
let actx: AudioContext | null = null
export function playChord(name: string, strum = true) {
  const pc = chordPitchClasses(name)
  if (!pc) return
  actx ??= new AudioContext()
  if (actx.state === 'suspended') void actx.resume()
  const t0 = actx.currentTime + 0.02
  // baixo na 2ª oitava, resto acima, sem repetir
  const notes = [36 + ((pc.bass + 12) % 12) + 12, ...pc.pcs.map((p) => 48 + p + (p < (pc.bass % 12) ? 12 : 0))]
  const out = actx.createGain(); out.gain.value = 0.18; out.connect(actx.destination)
  notes.forEach((m, i) => {
    const f = 440 * 2 ** ((m - 69) / 12)
    const t = t0 + (strum ? i * 0.035 : 0)
    for (const [mult, amp] of [[1, 1], [2, 0.5], [3, 0.25], [4, 0.12]] as const) {
      const o = actx!.createOscillator(), g = actx!.createGain()
      o.type = 'triangle'; o.frequency.value = f * mult
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(amp, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
      o.connect(g).connect(out); o.start(t); o.stop(t + 2.5)
    }
  })
}

// ---------- 2. trocas difíceis ----------
export function hardestChanges(chords: ChordEvent[], n = 3): { a: string; b: string; times: number; score: number }[] {
  const pairs = new Map<string, number>()
  for (let i = 1; i < chords.length; i++) {
    const a = chords[i - 1].chord, b = chords[i].chord
    if (a === b) continue
    const k = [a, b].sort().join('|')
    pairs.set(k, (pairs.get(k) ?? 0) + 1)
  }
  const diff = (x: string) => { const s = chordShape(x, 'violao'); return s ? (s.barre ? 3 : 0) + (s.baseFret > 1 ? 1 : 0) + s.frets.filter((f) => f > 0).length * 0.3 : 2 }
  return [...pairs.entries()].map(([k, times]) => {
    const [a, b] = k.split('|')
    const sa = chordShape(a, 'violao'), sb = chordShape(b, 'violao')
    const move = sa && sb ? Math.abs(center(sa) - center(sb)) * 0.4 + sa.frets.filter((f, i) => f !== sb.frets[i]).length * 0.35 : 2
    return { a, b, times, score: diff(a) + diff(b) + move + Math.min(times, 6) * 0.15 }
  }).sort((x, y) => y.score - x.score).slice(0, n)
}

// ---------- 3. compassos ----------
export interface Bar { t0: number; t1: number; slots: string[]; section?: string }
/** Divide a música em compassos e diz que acorde cai em cada tempo ("." = continua o mesmo). */
export function buildBars(chords: ChordEvent[], beats: number[], beatsPerBar: number, sections: { t0: number; label: string }[]): Bar[] {
  if (beats.length < beatsPerBar * 2 || !chords.length) return []
  // fase do compasso: a que faz mais trocas de acorde caírem no 1º tempo
  let phase = 0, best = -1
  for (let p = 0; p < beatsPerBar; p++) {
    let hits = 0
    for (const c of chords) {
      let j = 0, d = Infinity
      beats.forEach((b, k) => { const x = Math.abs(b - c.t0); if (x < d) { d = x; j = k } })
      if (d < 0.25 && (j - p) % beatsPerBar === 0) hits++
    }
    if (hits > best) { best = hits; phase = p }
  }
  const at = (t: number) => { let k = -1; for (let i = 0; i < chords.length; i++) if (chords[i].t0 <= t + 0.12) k = i; return k }
  const bars: Bar[] = []
  let lastChord = -2, si = 0
  for (let s = phase; s + beatsPerBar <= beats.length; s += beatsPerBar) {
    const t0 = beats[s], t1 = beats[s + beatsPerBar] ?? beats[beats.length - 1]
    const slots: string[] = []
    for (let k = 0; k < beatsPerBar; k++) {
      const idx = at(beats[s + k])
      slots.push(idx >= 0 && idx !== lastChord ? chords[idx].chord : idx < 0 ? '' : '.')
      if (idx >= 0) lastChord = idx
    }
    let section: string | undefined
    while (si < sections.length && sections[si].t0 <= t0 + 0.3) { section = sections[si].label; si++ }
    bars.push({ t0, t1, slots, section })
  }
  return bars
}

