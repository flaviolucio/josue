// Aprende com as correções da pessoa: quando ela troca um acorde da IA por outro (ex.: Dm -> D5),
// guardamos a troca de forma independente do tom ("menor -> power chord na mesma tônica").
// Nas próximas músicas, a revisão guiada sugere a mesma troca.
import { noteName, parseChord, preferFlats } from './chords'

const KEY = 'josue.learn'
type Rules = Record<string, number> // "qualidadeDe|intervalo|qualidadePara" -> quantas vezes

function load(): Rules { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Rules } catch { return {} } }
function save(r: Rules) { try { localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* */ } }

function ruleOf(from: string, to: string): string | null {
  const a = parseChord(from), b = parseChord(to)
  if (!a || !b || from === to) return null
  return `${a.quality}|${(b.root - a.root + 12) % 12}|${b.quality}`
}

export function recordCorrection(from: string, to: string) {
  const k = ruleOf(from, to)
  if (!k) return
  const r = load()
  r[k] = (r[k] ?? 0) + 1
  save(r)
}

/** Sugestão aprendida para este acorde (precisa ter sido feita pelo menos 2 vezes). */
export function learnedSuggestion(chord: string, key: string): { to: string; times: number } | null {
  const c = parseChord(chord)
  if (!c) return null
  let best: { to: string; times: number } | null = null
  for (const [k, n] of Object.entries(load())) {
    const [fq, iv, tq] = k.split('|')
    if (fq !== c.quality || n < 2) continue
    if (!best || n > best.times) best = { to: noteName(c.root + Number(iv), preferFlats(key)) + tq, times: n }
  }
  return best
}

export function forgetLearning() { save({}) }
