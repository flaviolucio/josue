// Alinhamento cifra: põe cada acorde em cima da palavra/sílaba certa e monta as linhas.
import type { ChordEvent, Section, Word } from './types'

export interface PlacedChord { index: number; name: string; t0: number; offset: number }
export interface LineWord { index: number; text: string; t0: number; t1: number; chords: PlacedChord[] }
export interface LyricLine { kind: 'lyric'; t0: number; t1: number; words: LineWord[]; section: number }
export interface ChordLine { kind: 'chords'; t0: number; t1: number; chords: PlacedChord[]; section: number }
export type CifraLine = LyricLine | ChordLine
export interface CifraBlock { section: number; label: string; t0: number; t1: number; lines: CifraLine[] }

const VOWELS = 'aeiouáéíóúâêôãõàüyAEIOUÁÉÍÓÚÂÊÔÃÕÀÜY'
const CLUSTERS = ['br', 'cr', 'dr', 'fr', 'gr', 'pr', 'tr', 'vr', 'bl', 'cl', 'fl', 'gl', 'pl', 'tl', 'ch', 'lh', 'nh', 'qu', 'gu']

/** Começos de sílaba aproximados (regras simples do português). */
export function syllableStarts(word: string): number[] {
  const starts = [0]
  const low = word.toLowerCase()
  let i = 0
  // pula até a primeira vogal
  while (i < low.length && !VOWELS.includes(low[i])) i++
  while (i < low.length) {
    while (i < low.length && VOWELS.includes(low[i])) i++ // núcleo
    let j = i
    while (j < low.length && !VOWELS.includes(low[j])) j++ // consoantes
    if (j >= low.length) break
    const cons = j - i
    let start: number
    if (cons <= 1) start = i
    else if (CLUSTERS.includes(low.slice(j - 2, j))) start = j - 2
    else start = j - 1
    if (start > starts[starts.length - 1] && /[a-zà-ü]/i.test(low[start] ?? '')) starts.push(start)
    i = j
  }
  return starts
}

function snapOffset(word: Word, t: number): number {
  const len = word.text.length
  if (len <= 2 || word.t1 <= word.t0 || t <= word.t0) return 0
  const frac = Math.min(0.999, (t - word.t0) / (word.t1 - word.t0))
  const target = frac * len
  const starts = syllableStarts(word.text)
  let best = 0
  for (const s of starts) if (s <= target + 0.5) best = s
  return best
}

export interface BuildOptions { lineGap?: number; maxWords?: number }

export function buildCifra(words: Word[], chords: ChordEvent[], sections: Section[], display: (c: string) => string, opts: BuildOptions = {}): CifraBlock[] {
  const lineGap = opts.lineGap ?? 0.6
  const maxWords = opts.maxWords ?? 9
  const secs = sections.length ? sections : [{ t0: 0, t1: Infinity, label: '' }]
  const secOf = (t: number) => {
    let k = 0
    for (let i = 0; i < secs.length; i++) if (t >= secs[i].t0 - 0.05) k = i
    return k
  }

  // 1) linhas de letra
  type Raw = { idx: number[]; section: number }
  const raw: Raw[] = []
  // letra colada: as linhas são as do texto original
  const fixedLines = words.length > 0 && words.every((w) => w.line !== undefined)
  words.forEach((w, i) => {
    const sec = secOf(w.t0)
    const cur = raw[raw.length - 1]
    const prev = words[i - 1]
    // troca de seção só quebra a linha se houver pausa (evita cortar frase no meio)
    const brk = !cur || (fixedLines ? w.line !== prev.line : (
      (cur.section !== sec && w.t0 - prev.t1 > 0.25) ||
      w.t0 - prev.t1 > lineGap ||
      cur.idx.length >= maxWords ||
      (/[.!?;]$/.test(prev.text) && cur.idx.length >= 3) ||
      (/,$/.test(prev.text) && cur.idx.length >= 5) ||
      /^\n/.test(w.text)))
    if (brk) raw.push({ idx: [i], section: sec })
    else cur.idx.push(i)
  })
  const lyricLines: LyricLine[] = raw.map((r) => ({
    kind: 'lyric',
    section: r.section,
    t0: words[r.idx[0]].t0,
    t1: words[r.idx[r.idx.length - 1]].t1,
    words: r.idx.map((i) => ({ index: i, text: words[i].text.replace(/^\n/, ''), t0: words[i].t0, t1: words[i].t1, chords: [] })),
  }))

  // 2) cada acorde vai para a palavra mais próxima, se houver letra perto
  const orphan: PlacedChord[] = []
  chords.forEach((c, ci) => {
    const name = display(c.chord)
    let best: { line: LyricLine; w: LineWord; d: number } | null = null
    for (const line of lyricLines) {
      if (c.t0 < line.t0 - 0.6 || c.t0 > line.t1 + 0.35) continue
      if (line.section !== secOf(c.t0) && sections.length) continue
      for (const w of line.words) {
        const inside = c.t0 >= w.t0 && c.t0 < w.t1
        const d = inside ? 0 : Math.abs(w.t0 - c.t0)
        if (!best || d < best.d) best = { line, w, d }
      }
    }
    if (best && best.d <= 0.6) {
      const wd = words[best.w.index]
      const offset = c.t0 > wd.t0 ? snapOffset(wd, c.t0) : 0
      // dois acordes na mesma posição: o mais recente vence (o anterior vira órfão se não couber)
      const clash = best.w.chords.find((p) => p.offset === offset)
      if (clash) {
        if (offset + 1 < best.w.text.length) best.w.chords.push({ index: ci, name, t0: c.t0, offset: Math.min(best.w.text.length - 1, offset + 1) })
        else orphan.push({ index: ci, name, t0: c.t0, offset: 0 })
      } else best.w.chords.push({ index: ci, name, t0: c.t0, offset })
      best.w.chords.sort((a, b) => a.offset - b.offset)
    } else orphan.push({ index: ci, name, t0: c.t0, offset: 0 })
  })

  // 3) acordes sem letra viram linhas só de acordes
  const chordLines: ChordLine[] = []
  for (const p of orphan) {
    const c = chords[p.index]
    const sec = secOf(c.t0)
    const cur = chordLines[chordLines.length - 1]
    const lyricBetween = cur && lyricLines.some((l) => l.t0 > cur.t1 - 0.01 && l.t0 < c.t0)
    if (!cur || cur.section !== sec || cur.chords.length >= 8 || lyricBetween || c.t0 - cur.t1 > 4) {
      chordLines.push({ kind: 'chords', section: sec, t0: c.t0, t1: c.t1, chords: [p] })
    } else { cur.chords.push(p); cur.t1 = c.t1 }
  }

  const all: CifraLine[] = [...lyricLines, ...chordLines].sort((a, b) => a.t0 - b.t0)
  // fim de cada linha = começo da próxima (para destacar a linha atual sem buracos)
  for (let i = 0; i < all.length - 1; i++) all[i].t1 = Math.max(all[i].t1, Math.min(all[i + 1].t0, all[i].t1 + 3))

  const blocks: CifraBlock[] = []
  for (const line of all) {
    const last = blocks[blocks.length - 1]
    if (!last || last.section !== line.section) {
      const s = secs[line.section]
      blocks.push({ section: line.section, label: s.label, t0: Math.min(s.t0, line.t0), t1: s.t1, lines: [line] })
    } else last.lines.push(line)
  }
  return blocks
}

// ---------- Exportação em texto ----------
function lyricLineToText(line: LyricLine): [string, string] {
  let lyric = ''
  let chordRow = ''
  line.words.forEach((w, wi) => {
    if (wi > 0) lyric += ' '
    let text = w.text
    let inserted = 0
    for (const c of w.chords) {
      let pos = lyric.length + c.offset + inserted
      const need = chordRow.length + (chordRow.length ? 1 : 0)
      if (pos < need) {
        // abre espaço na letra para o acorde não colar no anterior
        const pad = need - pos
        const cut = c.offset + inserted
        text = text.slice(0, cut) + (cut === 0 ? ' '.repeat(pad) : '-'.repeat(pad)) + text.slice(cut)
        inserted += pad
        pos += pad
      }
      chordRow = chordRow.padEnd(pos, ' ') + c.name
    }
    lyric += text
  })
  return [chordRow, lyric]
}

export function cifraToText(blocks: CifraBlock[], opts: { chords: boolean; lyrics: boolean; sections: boolean }): string {
  const out: string[] = []
  for (const b of blocks) {
    if (opts.sections && b.label) out.push(`[${b.label}]`)
    for (const line of b.lines) {
      if (line.kind === 'chords') {
        if (opts.chords) out.push(line.chords.map((c) => c.name).join('  '))
      } else {
        const [cr, ly] = lyricLineToText(line)
        if (opts.chords && cr.trim()) out.push(cr)
        if (opts.lyrics) out.push(ly)
      }
    }
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export function cifraToRows(blocks: CifraBlock[], opts: { chords: boolean; lyrics: boolean; sections: boolean }, notes?: Map<string, string>): { kind: 'section' | 'chord' | 'lyric' | 'blank' | 'note'; text: string }[] {
  const rows: { kind: 'section' | 'chord' | 'lyric' | 'blank' | 'note'; text: string }[] = []
  for (const b of blocks) {
    if (opts.sections && b.label) rows.push({ kind: 'section', text: `[${b.label}]` })
    for (const line of b.lines) {
      const note = notes?.get(line.t0.toFixed(1))
      if (note) rows.push({ kind: 'note', text: note })
      if (line.kind === 'chords') { if (opts.chords) rows.push({ kind: 'chord', text: line.chords.map((c) => c.name).join('  ') }) }
      else {
        const [cr, ly] = lyricLineToText(line)
        if (opts.chords && cr.trim()) rows.push({ kind: 'chord', text: cr })
        if (opts.lyrics) rows.push({ kind: 'lyric', text: ly })
      }
    }
    rows.push({ kind: 'blank', text: '' })
  }
  return rows
}

export function cifraToChordPro(blocks: CifraBlock[], meta: { title: string; key: string; bpm: number; timeSig: string; capo: number }): string {
  const out: string[] = [`{title: ${meta.title}}`, `{key: ${meta.key}}`, `{tempo: ${Math.round(meta.bpm)}}`, `{time: ${meta.timeSig}}`]
  if (meta.capo) out.push(`{capo: ${meta.capo}}`)
  out.push('')
  for (const b of blocks) {
    const isChorus = /refr/i.test(b.label)
    if (b.label) out.push(isChorus ? `{start_of_chorus: ${b.label}}` : `{comment: ${b.label}}`)
    for (const line of b.lines) {
      if (line.kind === 'chords') out.push(line.chords.map((c) => `[${c.name}]`).join(' '))
      else out.push(line.words.map((w) => {
        let t = w.text
        for (const c of [...w.chords].sort((a, b2) => b2.offset - a.offset)) t = t.slice(0, c.offset) + `[${c.name}]` + t.slice(c.offset)
        return t
      }).join(' '))
    }
    if (b.label && isChorus) out.push('{end_of_chorus}')
    out.push('')
  }
  return out.join('\n')
}

export function chordAtTime(chords: ChordEvent[], t: number): number {
  let lo = 0, hi = chords.length - 1, ans = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (chords[m].t0 <= t) { ans = m; lo = m + 1 } else hi = m - 1 }
  return ans >= 0 && t < chords[ans].t1 + 0.05 ? ans : -1
}

/** Tempo para mover um acorde até uma sílaba (palavra + posição). */
export function timeForSyllable(word: Word, offset: number): number {
  if (offset <= 0 || word.text.length === 0) return word.t0
  return word.t0 + ((word.t1 - word.t0) * offset) / word.text.length + 0.001
}
