// Converte a tablatura gerada no servidor (notas na grade de semicolcheias) em alphaTex,
// o formato de texto que o alphaTab desenha como partitura/tablatura estilo Guitar Pro.
// Também faz a conversão de tempo real (segundos do áudio) <-> tempo da partitura (ms "virtuais"),
// já que a música real oscila de andamento e a partitura usa um BPM fixo.
import type { TabNote, TabTrack, Tabs } from './types'

export type TabView = 'all' | 'base' | 'solo'

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
const midiName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`

// duração em semicolcheias -> notação alphaTex (valor + pontuado)
const DUR: [number, string][] = [
  [16, '1'], [12, '2 {d}'], [8, '2'], [6, '4 {d}'], [4, '4'], [3, '8 {d}'], [2, '8'], [1, '16'],
]

function pieces(slots: number): string[] {
  const out: string[] = []
  let left = slots
  while (left > 0) {
    const [v, d] = DUR.find(([v]) => v <= left)!
    out.push(d)
    left -= v
  }
  return out
}

/** Escreve uma duração com nota/acorde na 1ª parte e pausas no resto. */
function emit(content: string | null, slots: number): string[] {
  return pieces(slots).map((d, i) => {
    const [val, eff] = d.split(' ')
    const fx = eff ? ` ${eff}` : ''
    if (i === 0 && content) return `${content}.${val}${fx}`
    return `r.${val}${fx}`
  })
}

export interface TexOptions {
  title: string; view: TabView; slotsPerBar: number; totalSlots: number; bpm: number
  /** nomes dos acordes, na posição (semicolcheia) onde começam — aparecem em cima da tablatura */
  chords?: { slot: number; name: string }[]
}

/** Põe o nome do acorde no 1º tempo desenhado de cada troca. */
function withChord(token: string, name: string) {
  const ch = `ch "${name.replace(/"/g, "'")}"`
  return token.endsWith('}') ? `${token.slice(0, -1)} ${ch}}` : `${token} {${ch}}`
}
/** Para cada compasso, a posição (semicolcheia) de cada tempo desenhado — liga o clique no desenho à nota. */
export type BeatSlots = number[][]

export const viewNotes = (track: TabTrack, view: TabView) =>
  track.notes.filter((n) => n.q0 >= 0 && (view === 'all' || n.role === view))

export function trackToTex(track: TabTrack, opt: TexOptions): { tex: string; beats: BeatSlots } {
  const bySlot = new Map<number, TabNote[]>()
  for (const n of viewNotes(track, opt.view)) {
    const g = bySlot.get(n.q0) ?? []
    if (!g.some((o) => o.string === n.string)) g.push(n)
    bySlot.set(n.q0, g)
  }
  const starts = [...bySlot.keys()].sort((a, b) => a - b)
  const per = opt.slotsPerBar
  const nBars = Math.max(1, Math.ceil(Math.max(opt.totalSlots, (starts[starts.length - 1] ?? 0) + 1) / per))
  const bars: string[] = []
  const beats: BeatSlots = []
  // trocas de acorde arredondadas para a grade (sem repetir o mesmo acorde seguido)
  const chordAt = new Map<number, string>()
  let lastName = ''
  for (const c of [...(opt.chords ?? [])].sort((a, b) => a.slot - b.slot)) {
    if (!c.name || c.name === 'N' || c.name === lastName) continue
    chordAt.set(Math.max(0, Math.round(c.slot)), c.name)
    lastName = c.name
  }
  const chordSlots = [...chordAt.keys()].sort((a, b) => a - b)
  let si = 0
  for (let b = 0; b < nBars; b++) {
    const b0 = b * per, b1 = b0 + per
    const tokens: string[] = []
    const slots: number[] = []
    const put = (content: string | null, at: number, len: number) => {
      // pausas são quebradas nas trocas de acorde, para o nome cair no lugar certo
      if (!content) {
        const cut = chordSlots.find((c) => c > at && c < at + len)
        if (cut !== undefined) { put(null, at, cut - at); put(null, cut, at + len - cut); return }
      }
      let pos = at
      emit(content, len).forEach((tk, i) => {
        tokens.push(tk); slots.push(pos)
        pos += pieces(len)[i] ? DUR.find(([, d]) => d === pieces(len)[i])![0] : 0
      })
    }
    let cur = b0
    while (si < starts.length && starts[si] < b1) {
      const s = starts[si]
      if (s > cur) put(null, cur, s - cur)
      const next = Math.min(starts[si + 1] ?? b1, b1)
      const g = bySlot.get(s)!
      const body = g.map((n) => `${n.fret}.${n.string}`)
      const len = Math.max(1, Math.min(next - s, Math.max(...g.map((n) => n.qd || 1))))
      put(body.length === 1 ? body[0] : `(${body.join(' ')})`, s, len)
      if (s + len < next) put(null, s + len, next - s - len)
      cur = next
      si++
    }
    if (cur < b1) put(null, cur, b1 - cur)
    for (const [c, name] of chordAt) {
      if (c < b0 || c >= b1) continue
      const i = slots.findIndex((x) => x >= c)
      if (i >= 0) tokens[i] = withChord(tokens[i], name)
    }
    bars.push(tokens.join(' '))
    beats.push(slots)
  }
  const isBass = track.tuning.length === 4
  const tuning = track.tuning.map(midiName).join(' ')
  const head = [
    `\\title "${opt.title.replace(/"/g, "'")}"`,
    `\\tempo ${Math.round(opt.bpm)}`,
    '.',
    `\\track "${track.name}"`,
    '\\staff {score tabs}',
    `\\tuning ${tuning}`,
    `\\instrument ${isBass ? 33 : 25}`,
    `\\ts ${per / 4} 4`,
  ].join('\n')
  return { tex: `${head}\n${bars.join(' |\n')}`, beats }
}

// ---------- MusicXML (partitura + tablatura) ----------
const STEP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B']
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
const XML_TYPE: Record<number, [string, boolean]> = {
  16: ['whole', false], 12: ['half', true], 8: ['half', false], 6: ['quarter', true], 4: ['quarter', false],
  3: ['eighth', true], 2: ['eighth', false], 1: ['16th', false],
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function trackToMusicXml(track: TabTrack, opt: TexOptions): string {
  const per = opt.slotsPerBar
  const notes = viewNotes(track, opt.view)
  const bySlot = new Map<number, TabNote[]>()
  for (const n of notes) { const g = bySlot.get(n.q0) ?? []; if (!g.some((o) => o.string === n.string)) g.push(n); bySlot.set(n.q0, g) }
  const starts = [...bySlot.keys()].sort((a, b) => a - b)
  const nBars = Math.max(1, Math.ceil(Math.max(opt.totalSlots, (starts[starts.length - 1] ?? 0) + 1) / per))
  const nStr = track.tuning.length
  const isBass = nStr === 4
  const pitchXml = (m: number) => `<pitch><step>${STEP[m % 12]}</step>${ALTER[m % 12] ? '<alter>1</alter>' : ''}<octave>${Math.floor(m / 12) - 1}</octave></pitch>`
  const noteXml = (n: TabNote | null, len: number, chord: boolean) => {
    const [type, dot] = XML_TYPE[len]
    const body = n
      ? `${chord ? '<chord/>' : ''}${pitchXml(n.pitch)}`
      : '<rest/>'
    const tech = n ? `<notations><technical><string>${n.string}</string><fret>${n.fret}</fret></technical></notations>` : ''
    return `<note>${body}<duration>${len}</duration><voice>1</voice><type>${type}</type>${dot ? '<dot/>' : ''}${tech}</note>`
  }
  const measures: string[] = []
  let si = 0
  for (let b = 0; b < nBars; b++) {
    const b0 = b * per, b1 = b0 + per
    const out: string[] = []
    const rest = (len: number) => pieces(len).forEach((d) => out.push(noteXml(null, DUR.find(([, x]) => x === d)![0], false)))
    let cur = b0
    while (si < starts.length && starts[si] < b1) {
      const s = starts[si]
      if (s > cur) rest(s - cur)
      const next = Math.min(starts[si + 1] ?? b1, b1)
      const g = bySlot.get(s)!
      const len0 = Math.max(1, Math.min(next - s, Math.max(...g.map((n) => n.qd || 1))))
      const ps = pieces(len0).map((d) => DUR.find(([, x]) => x === d)![0])
      g.forEach((n, i) => out.push(noteXml(n, ps[0], i > 0)))
      ps.slice(1).forEach((l) => out.push(noteXml(null, l, false)))
      if (s + len0 < next) rest(next - s - len0)
      cur = next; si++
    }
    if (cur < b1) rest(b1 - cur)
    const attrs = b === 0
      ? `<attributes><divisions>4</divisions><time><beats>${per / 4}</beats><beat-type>4</beat-type></time><clef><sign>${isBass ? 'F' : 'G'}</sign><line>${isBass ? 4 : 2}</line><clef-octave-change>-1</clef-octave-change></clef>` +
        `<staff-details><staff-lines>${nStr}</staff-lines>${track.tuning.map((m, i) => `<staff-tuning line="${nStr - i}"><tuning-step>${STEP[m % 12]}</tuning-step>${ALTER[m % 12] ? '<tuning-alter>1</tuning-alter>' : ''}<tuning-octave>${Math.floor(m / 12) - 1}</tuning-octave></staff-tuning>`).join('')}</staff-details></attributes>` +
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(opt.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(opt.bpm)}"/></direction>`
      : ''
    measures.push(`<measure number="${b + 1}">${attrs}${out.join('')}</measure>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>${esc(opt.title)}</work-title></work>
<part-list><score-part id="P1"><part-name>${esc(track.name)}</part-name><score-instrument id="P1-I1"><instrument-name>${esc(track.name)}</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>${isBass ? 34 : 26}</midi-program></midi-instrument></score-part></part-list>
<part id="P1">${measures.join('\n')}</part></score-partwise>
`
}

// ---------- tempo real <-> tempo da partitura ----------
export class TimeMap {
  private beats: number[]
  private grid: number
  private msPerSlot: number
  constructor(tabs: Tabs) {
    this.beats = tabs.beats.length > 1 ? tabs.beats : [0, 60 / Math.max(40, tabs.bpm)]
    this.grid = tabs.grid || 4
    this.msPerSlot = 60000 / Math.round(tabs.bpm) / this.grid
  }
  /** segundos reais -> posição na grade (semicolcheias, fracionário) */
  slotAt(t: number): number {
    const b = this.beats
    let lo = 0, hi = b.length - 1
    if (t <= b[0]) return ((t - b[0]) / (b[1] - b[0])) * this.grid
    if (t >= b[hi]) return (hi + (t - b[hi]) / (b[hi] - b[hi - 1])) * this.grid
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m; else hi = m }
    return (lo + (t - b[lo]) / (b[lo + 1] - b[lo])) * this.grid
  }
  /** posição na grade -> segundos reais */
  timeAt(slot: number): number {
    const b = this.beats
    const x = slot / this.grid
    const i = Math.max(0, Math.min(b.length - 2, Math.floor(x)))
    return b[i] + (x - i) * (b[i + 1] - b[i])
  }
  realToVirtualMs(t: number) { return Math.max(0, this.slotAt(t) * this.msPerSlot) }
  virtualMsToReal(ms: number) { return this.timeAt(ms / this.msPerSlot) }
  /** ticks do alphaTab (960 por semínima) -> segundos reais */
  tickToReal(tick: number) { return this.timeAt((tick / 960) * this.grid) }
}
