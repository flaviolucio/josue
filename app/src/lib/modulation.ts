// Modulação: detecta quando a música muda de tom no meio (ex.: o último refrão sobe meio tom).
import { noteName, parseChord, preferFlats, isMinorQuality } from './chords'
import type { ChordEvent, Section } from './types'

const MAJ = [0, 2, 4, 5, 7, 9] // I ii iii IV V vi (raízes)
const MAJQ = [false, true, true, false, false, true] // menor?

function keyScore(chords: ChordEvent[], root: number): number {
  let s = 0
  for (const c of chords) {
    const p = parseChord(c.chord)
    if (!p) continue
    const d = c.t1 - c.t0
    const iv = (p.root - root + 12) % 12
    const k = MAJ.indexOf(iv)
    if (k >= 0 && (isMinorQuality(p.quality) === MAJQ[k] || /^(5|sus)/.test(p.quality))) s += d * (iv === 0 ? 1.4 : 1)
    else s -= d * 0.6
  }
  return s
}

export interface Modulation { t0: number; semis: number; key: string }
/** Mudança de tom que se mantém até o fim (o caso típico do louvor). */
export function detectModulation(chords: ChordEvent[], sections: Section[], key: string): Modulation | null {
  const k = parseChord(key || '')
  if (!k || sections.length < 3) return null
  const minor = isMinorQuality(k.quality)
  const home = minor ? (k.root + 3) % 12 : k.root // relativo maior
  for (let si = 1; si < sections.length; si++) {
    const rest = chords.filter((c) => c.t0 >= sections[si].t0 - 0.1)
    if (rest.length < 3) break
    let best = home, bestS = -Infinity
    for (let r = 0; r < 12; r++) { const sc = keyScore(rest, r); if (sc > bestS) { bestS = sc; best = r } }
    const shift = (best - home + 12) % 12
    const homeS = keyScore(rest, home)
    // sobe 1 ou 2 semitons, com folga clara sobre o tom original, e a parte anterior estava no tom original
    const before = chords.filter((c) => c.t1 <= sections[si].t0 + 0.1)
    // a própria seção já precisa estar no tom novo (senão a mudança é numa seção mais adiante)
    const own = chords.filter((c) => c.t0 >= sections[si].t0 - 0.1 && c.t0 < (sections[si + 1]?.t0 ?? Infinity))
    if ((shift === 1 || shift === 2) && bestS > homeS * 1.3 + 2 && keyScore(before, home) >= keyScore(before, best) && keyScore(own, best) > keyScore(own, home)) {
      const newRoot = minor ? (best - 3 + 12) % 12 : best
      const name = noteName(newRoot, preferFlats(noteName(newRoot, true))) + (minor ? 'm' : '')
      return { t0: sections[si].t0, semis: shift, key: name }
    }
  }
  return null
}
