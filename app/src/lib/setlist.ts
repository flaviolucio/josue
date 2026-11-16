// Repertório: cifras em ordem, cada uma no tom escolhido, e o PDF único com capa e índice.
import { jsPDF } from 'jspdf'
import { buildCifra } from './cifra'
import { labelSections } from './sections'
import { preferFlats, transposeChord, transposeKey } from './chords'
import { renderCifra } from './exporters'
import { C, FOOTER_SPACE, M, drawCover, drawFooters, ink, loadLogo } from './pdfBrand'
import type { Setlist, SetlistItem, Song } from './types'

/** Tom em que a música vai soar e o desenho (shape) a tocar, considerando o capotraste. */
export function itemKeys(song: Song, it: SetlistItem) {
  const key = song.meta.key
  const shift = it.semis - (it.capo ?? 0)
  return { sounding: key ? transposeKey(key, it.semis) : '', shape: key ? transposeKey(key, shift) : '', shift }
}

export const hasCifra = (s: Song | undefined) => !!s && !s.gp && s.status === 'ready' && (s.chords.length > 0 || s.words.length > 0)

export function formatDate(iso?: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : iso
}

export function setlistFileName(sl: Setlist) {
  return `${(sl.name || 'Repertório').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'Repertorio'}.pdf`
}

/** Gera o PDF do repertório; com asBlob, devolve o arquivo em vez de baixar (para compartilhar). */
export async function exportSetlistPdf(sl: Setlist, songs: Map<string, Song>, asBlob = false): Promise<Blob | void> {
  const d = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight()
  const logo = await loadLogo()
  const items = sl.items.map((it) => ({ it, song: songs.get(it.songId) })).filter((x) => hasCifra(x.song)) as { it: SetlistItem; song: Song }[]
  if (!items.length) throw new Error('Nenhuma música deste repertório tem cifra pronta.')

  // capa (o índice é desenhado no fim, quando as páginas de cada música já são conhecidas)
  let y = drawCover(d, logo, sl.name || 'Repertório', ['Repertório', formatDate(sl.date)].filter(Boolean).join(' · '), [`${items.length} ${items.length === 1 ? 'música' : 'músicas'}`])
  const starts: number[] = []
  const layers = { chords: true, lyrics: true, sections: true }
  items.forEach(({ it, song }, i) => {
    const k = itemKeys(song, it)
    const flats = preferFlats(k.shape)
    const display = (c: string) => transposeChord(c, k.shift, flats)
    const blocks = buildCifra(song.words, song.chords, labelSections(song.sections, song.words), display)
    d.addPage()
    starts.push(d.getNumberOfPages())
    renderCifra(d, logo, blocks, { title: song.title, key: k.shape || '?', bpm: song.meta.bpm, timeSig: song.meta.timeSig, capo: it.capo ?? 0, transpose: it.semis }, layers, `${sl.name || 'Repertório'} · ${i + 1} de ${items.length}`, new Map((song.notes ?? []).map((n) => [n.t0.toFixed(1), n.text])))
  })

  // índice na capa
  d.setPage(1)
  d.setFont('helvetica', 'bold'); d.setFontSize(12); ink.color(d, C.ink)
  d.text('Ordem das músicas', M, y); y += 8
  ink.stroke(d, C.gold); d.setLineWidth(1); d.line(M, y, M + 130, y); y += 22
  items.forEach(({ it, song }, i) => {
    if (y > H - FOOTER_SPACE - 30) return
    const k = itemKeys(song, it)
    d.setFont('helvetica', 'bold'); d.setFontSize(11); ink.color(d, C.goldDeep)
    d.text(String(i + 1).padStart(2, '0'), M, y)
    d.setFont('helvetica', 'normal'); ink.color(d, C.ink)
    const title = d.splitTextToSize(song.title, W - 2 * M - 190)[0] as string
    d.text(title, M + 26, y)
    d.setFontSize(10); ink.color(d, C.muted)
    const tom = (it.singer ? it.singer + ' · ' : '') + (k.sounding ? `Tom ${k.sounding}` + (it.capo ? ` (capo ${it.capo}, desenho ${k.shape})` : '') : '')
    d.text(tom, W - M - 40, y, { align: 'right' })
    d.text(`p. ${starts[i]}`, W - M, y, { align: 'right' })
    ink.stroke(d, C.line); d.setLineWidth(0.4); d.line(M, y + 8, W - M, y + 8)
    y += 24
  })
  if (sl.notes?.trim()) {
    y += 10
    d.setFont('helvetica', 'bold'); d.setFontSize(10); ink.color(d, C.ink); d.text('Observações', M, y); y += 14
    d.setFont('helvetica', 'normal'); d.setFontSize(10); ink.color(d, C.muted)
    for (const line of d.splitTextToSize(sl.notes.trim(), W - 2 * M) as string[]) { if (y > H - FOOTER_SPACE - 10) break; d.text(line, M, y); y += 13 }
  }
  drawFooters(d)
  if (asBlob) return d.output('blob')
  d.save(setlistFileName(sl))
}
