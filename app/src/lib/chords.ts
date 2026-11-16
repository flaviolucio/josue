// Funções puras sobre nomes de acordes: leitura, transposição, simplificação e notas.

export const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export interface ParsedChord {
  root: number
  quality: string // tudo o que vem depois da tônica, sem o baixo (ex.: "m7", "sus4", "")
  bass: number | null
  flat: boolean
}

export function noteIndex(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(name.trim())
  if (!m) return null
  let n = LETTER[m[1].toUpperCase()]
  for (const c of m[2]) n += c === '#' || c === '♯' ? 1 : -1
  return ((n % 12) + 12) % 12
}

export function parseChord(name: string): ParsedChord | null {
  const s = name.trim()
  if (!s || s === 'N' || s === 'N.C.') return null
  const m = /^([A-G])([#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(s)
  if (!m) return null
  const root = noteIndex(m[1] + m[2])!
  const bass = m[4] ? noteIndex(m[4]) : null
  return { root, quality: m[3] ?? '', bass, flat: m[2] === 'b' || m[2] === '♭' }
}

/** Tonalidades que costumam ser escritas com bemóis. */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'])

export function preferFlats(key: string | null | undefined): boolean {
  return !!key && FLAT_KEYS.has(key)
}

export function noteName(i: number, flats = false): string {
  const n = ((i % 12) + 12) % 12
  return (flats ? FLATS : SHARPS)[n]
}

export function chordToString(c: ParsedChord, flats = false): string {
  return noteName(c.root, flats) + c.quality + (c.bass !== null && c.bass !== c.root ? '/' + noteName(c.bass, flats) : '')
}

export function transposeChord(name: string, semis: number, flats?: boolean): string {
  const c = parseChord(name)
  if (!c) return name
  const useFlats = flats ?? c.flat
  return chordToString({ ...c, root: c.root + semis, bass: c.bass === null ? null : c.bass + semis }, useFlats)
}

export function transposeKey(key: string, semis: number): string {
  const c = parseChord(key)
  if (!c) return key
  const minor = c.quality.startsWith('m')
  const sharpName = noteName(c.root + semis, false) + (minor ? 'm' : '')
  const flatName = noteName(c.root + semis, true) + (minor ? 'm' : '')
  if (sharpName === flatName) return sharpName
  return FLAT_KEYS.has(flatName) ? flatName : sharpName
}

export function isMinorQuality(q: string): boolean {
  return /^(m(?!aj)|min|-|dim|°|ø)/.test(q)
}

/** Modo "Simples": só tríades maiores e menores, sem baixo. */
export function simplifyChord(name: string, flats?: boolean): string {
  const c = parseChord(name)
  if (!c) return name
  // power chord já é o jeito fácil (e mudar para tríade muda o som): continua D5
  if (/^5(?!\+)/.test(c.quality)) return noteName(c.root, flats ?? c.flat) + '5'
  return noteName(c.root, flats ?? c.flat) + (isMinorQuality(c.quality) ? 'm' : '')
}

/** Intervalos (semitons a partir da tônica) de cada qualidade. */
export function qualityIntervals(q: string): number[] {
  // parênteses da notação brasileira não mudam as notas: m(7M) = m7M, m7(b5) = m7b5
  const s = q.replace('♭', 'b').replace('♯', '#').replace(/[()]/g, '')
  let third = 4
  let fifth = 7
  const extra: number[] = []
  let rest = s
  // power chord: só tônica e quinta (+ oitava)
  if (/^5(?!\+)/.test(rest)) return [0, 7]
  if (/^(dim|°)/.test(rest)) { third = 3; fifth = 6; rest = rest.replace(/^(dim|°)/, ''); if (rest.startsWith('7')) { extra.push(9); rest = rest.slice(1) } }
  else if (/^(ø|m7b5)/.test(rest)) { third = 3; fifth = 6; extra.push(10); rest = rest.replace(/^(ø7?|m7b5)/, '') }
  else if (/^(aug|\+)/.test(rest)) { fifth = 8; rest = rest.replace(/^(aug|\+)/, '') }
  else if (/^(m(?!aj)|min|-)/.test(rest)) { third = 3; rest = rest.replace(/^(min|m|-)/, '') }
  if (/^(maj7|M7|7M|Δ)/.test(rest)) { extra.push(11); rest = rest.replace(/^(maj7|M7|7M|Δ)/, '') }
  else if (/^maj9/.test(rest)) { extra.push(11, 14); rest = rest.slice(4) }
  else if (/^13/.test(rest)) { extra.push(10, 14, 21); rest = rest.slice(2) }
  else if (/^11/.test(rest)) { extra.push(10, 14, 17); rest = rest.slice(2) }
  else if (/^9/.test(rest)) { extra.push(10, 14); rest = rest.slice(1) }
  else if (/^7/.test(rest)) { extra.push(10); rest = rest.slice(1) }
  else if (/^6/.test(rest)) { extra.push(9); rest = rest.slice(1) }
  let thirdOut: number | null = third
  for (const m of rest.matchAll(/(sus2|sus4|sus|add9|add2|add11|add4|b5|#5|b9|#9|#11|b13|\(9\)|\(11\))/g)) {
    switch (m[1]) {
      case 'sus2': thirdOut = null; extra.push(2); break
      case 'sus4': case 'sus': thirdOut = null; extra.push(5); break
      case 'add9': case 'add2': case '(9)': extra.push(14); break
      case 'add11': case 'add4': case '(11)': extra.push(17); break
      case 'b5': fifth = 6; break
      case '#5': fifth = 8; break
      case 'b9': extra.push(13); break
      case '#9': extra.push(15); break
      case '#11': extra.push(18); break
      case 'b13': extra.push(20); break
    }
  }
  const out = [0, fifth, ...extra]
  if (thirdOut !== null) out.splice(1, 0, thirdOut)
  return out
}

export function chordPitchClasses(name: string): { root: number; bass: number; pcs: number[] } | null {
  const c = parseChord(name)
  if (!c) return null
  const pcs = [...new Set(qualityIntervals(c.quality).map((i) => (c.root + i) % 12))]
  const bass = c.bass ?? c.root
  if (!pcs.includes(bass)) pcs.push(bass)
  return { root: c.root, bass, pcs }
}

/** Lista de tonalidades para o seletor de transposição. */
export function transposeOptions(key: string): { semis: number; label: string }[] {
  const out: { semis: number; label: string }[] = []
  for (let s = -6; s <= 6; s++) out.push({ semis: s, label: `${transposeKey(key, s)}${s === 0 ? ' (original)' : ` (${s > 0 ? '+' : ''}${s})`}` })
  return out
}

export const QUALITY_SUGGESTIONS = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2', 'add9', 'dim', '6', 'm6', '9', 'aug']
