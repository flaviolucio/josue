// Revisão guiada: aponta os acordes em que a IA provavelmente errou, para a pessoa conferir
// só esses trechos. Regras simples e explicáveis (sem "caixa-preta"):
//  1. acorde fora do tom (nem do campo harmônico nem dos empréstimos mais comuns);
//  2. acorde curtíssimo espremido entre dois acordes iguais (piscada da detecção).
import { noteName, parseChord, preferFlats } from './chords'
import type { ChordEvent } from './types'
import { learnedSuggestion } from './learn'

export interface ReviewFlag { index: number; kind: 'fora-do-tom' | 'curto' | 'aprendido'; reason: string; suggestion?: string }

type Q = 'M' | 'm' | 'dim'
const qOf = (quality: string): Q | null => {
  if (/^(dim|°|o(?!m))/.test(quality) || /m7\(?b5|ø/.test(quality)) return 'dim'
  if (/^(m(?!aj)|min|-)/.test(quality)) return 'm'
  if (/^(5|sus)/.test(quality)) return null // power chord / sus: sem terça, vale qualquer qualidade
  return 'M'
}

// [grau em semitons, qualidade] — campo harmônico + empréstimos frequentes na música popular/gospel
const MAJOR: [number, Q][] = [[0, 'M'], [2, 'm'], [4, 'm'], [5, 'M'], [7, 'M'], [9, 'm'], [11, 'dim'],
  [10, 'M'], [5, 'm'], [2, 'M'], [4, 'M'], [8, 'M'], [9, 'M'], [3, 'M']]
const MINOR: [number, Q][] = [[0, 'm'], [2, 'dim'], [3, 'M'], [5, 'm'], [7, 'm'], [8, 'M'], [10, 'M'],
  [7, 'M'], [5, 'M'], [0, 'M'], [2, 'm'], [11, 'dim'], [1, 'M']]

const fmt = (root: number, q: Q, flats: boolean) => noteName(root, flats) + (q === 'm' ? 'm' : q === 'dim' ? 'dim' : '')

export function reviewChords(chords: ChordEvent[], key: string): ReviewFlag[] {
  const out: ReviewFlag[] = []
  const k = parseChord(key || '')
  const allowed: { root: number; q: Q }[] = k
    ? ((/^m(?!aj)/.test(k.quality) ? MINOR : MAJOR).map(([deg, q]) => ({ root: (k.root + deg) % 12, q })))
    : []
  const flats = preferFlats(key)
  const isOk = (root: number, q: Q | null) => q === null ? allowed.some((a) => a.root === root) : allowed.some((a) => a.root === root && a.q === q)

  chords.forEach((c, i) => {
    const p = parseChord(c.chord)
    if (!p) return
    const q = qOf(p.quality)
    const prev = chords[i - 1], next = chords[i + 1]
    // 2. piscada curtinha entre dois acordes iguais
    if (prev && next && c.t1 - c.t0 < 0.45 && prev.chord === next.chord && prev.chord !== c.chord) {
      out.push({ index: i, kind: 'curto', reason: `Dura menos de meio segundo, entre dois ${prev.chord}. Pode ser engano da detecção.`, suggestion: prev.chord })
      return
    }
    // 1. fora do tom
    if (allowed.length && !isOk(p.root, q)) {
      // preferência: os 7 acordes do próprio tom (início da lista) antes dos empréstimos
      const core = allowed.slice(0, 7)
      const isNear = (a: { root: number }) => a.root === (p.root + 1) % 12 || a.root === (p.root + 11) % 12
      const sug = core.find((a) => a.root === p.root)
        ?? core.find((a) => isNear(a) && (a.q === q || q === null))
        ?? core.find(isNear)
        ?? allowed.find((a) => a.root === p.root && a.q !== q)
        ?? allowed.find(isNear)
      out.push({
        index: i, kind: 'fora-do-tom',
        reason: `${c.chord} não costuma aparecer no tom de ${key}.`,
        suggestion: sug ? fmt(sug.root, sug.q, flats) : undefined,
      })
    }
  })
  // 3. correções que a pessoa costuma fazer (aprendidas em outras músicas)
  const flagged = new Set(out.map((f) => f.index))
  chords.forEach((c, i) => {
    if (flagged.has(i)) return
    const l = learnedSuggestion(c.chord, key)
    if (l && l.to !== c.chord) out.push({ index: i, kind: 'aprendido', reason: `Você já fez esta troca ${l.times} vezes em outras músicas (${c.chord} → ${l.to}).`, suggestion: l.to })
  })
  return out.sort((a, b) => a.index - b.index)
}
