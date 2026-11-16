// Exportar: TXT (acorde em cima da letra), ChordPro (.cho), PDF e imprimir.
import { jsPDF } from 'jspdf'
import { cifraToChordPro, cifraToRows, cifraToText, type CifraBlock } from './cifra'
import { chordShape, type Shape } from './diagrams'
import { C, FOOTER_SPACE, M, drawCover, drawFooters, drawRunningHead, ink, loadLogo } from './pdfBrand'

export interface ExportMeta { title: string; key: string; bpm: number; timeSig: string; capo: number; transpose: number }
type Layers = { chords: boolean; lyrics: boolean; sections: boolean }

function safeName(s: string) { return (s || 'cifra').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'cifra' }

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function header(meta: ExportMeta) {
  const parts = [`Tom: ${meta.key}`, `BPM: ${Math.round(meta.bpm)}`, `Compasso: ${meta.timeSig}`]
  if (meta.capo) parts.push(`Capotraste na ${meta.capo}ª casa`)
  return parts.join('   ')
}

export function exportTxt(blocks: CifraBlock[], meta: ExportMeta, layers: Layers) {
  const text = `${meta.title}\n${header(meta)}\n\n${cifraToText(blocks, layers)}`
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), safeName(meta.title) + '.txt')
}

export function exportChordPro(blocks: CifraBlock[], meta: ExportMeta) {
  download(new Blob([cifraToChordPro(blocks, meta)], { type: 'text/plain;charset=utf-8' }), safeName(meta.title) + '.cho')
}

export function metaChips(meta: { key?: string; bpm?: number; timeSig?: string; capo?: number }) {
  const chips: string[] = []
  if (meta.key) chips.push(`Tom ${meta.key}`)
  if (meta.bpm) chips.push(`${Math.round(meta.bpm)} BPM`)
  if (meta.timeSig) chips.push(`Compasso ${meta.timeSig}`)
  if (meta.capo) chips.push(`Capotraste na ${meta.capo}ª casa`)
  return chips
}

// PDF da cifra: capa com a identidade do Josué, seções em etiquetas, acordes em dourado escuro,
// duas colunas quando as linhas cabem, e no fim os desenhos dos acordes usados.
export async function exportPdf(blocks: CifraBlock[], meta: ExportMeta, layers: Layers, notes?: Map<string, string>) {
  const d = new jsPDF({ unit: 'pt', format: 'a4' })
  renderCifra(d, await loadLogo(), blocks, meta, layers, 'Cifra', notes)
  drawFooters(d)
  d.save(safeName(meta.title) + '.pdf')
}

/** Desenha uma cifra a partir da página atual (que deve estar em branco). Usado também no PDF do repertório. */
export function renderCifra(d: jsPDF, logo: string | null, blocks: CifraBlock[], meta: ExportMeta, layers: Layers, subtitle: string, notes?: Map<string, string>) {
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight()
  const top0 = drawCover(d, logo, meta.title, subtitle, metaChips(meta))
  const bottom = H - FOOTER_SPACE - 8

  const size = 10.5, lh = size * 1.3
  d.setFont('courier', 'normal'); d.setFontSize(size)
  const charW = d.getTextWidth('M')
  const rows = cifraToRows(blocks, layers, notes)
  const longest = Math.max(0, ...rows.filter((r) => r.kind === 'chord' || r.kind === 'lyric').map((r) => r.text.trimEnd().length))
  const gap = 28
  const colW2 = (W - 2 * M - gap) / 2
  const twoCols = longest <= Math.floor(colW2 / charW)
  const colW = twoCols ? colW2 : W - 2 * M
  const cols = Math.floor(colW / charW)

  // monta "grupos" que não podem ser partidos (seção + 1º par, ou par acorde/letra)
  type Item = { kind: 'section' | 'chord' | 'lyric' | 'blank' | 'note'; text: string }
  const groups: Item[][] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.kind === 'blank') { groups.push([r]); continue }
    if (r.kind === 'section' || r.kind === 'note') { groups.push([r]); continue }
    const pair: Item[] = r.kind === 'chord' && rows[i + 1]?.kind === 'lyric' ? [r, rows[++i]] : [r]
    const len = Math.max(...pair.map((p) => p.text.length))
    for (let c = 0; c < Math.max(1, len); c += cols) groups.push(pair.map((p) => ({ kind: p.kind, text: p.text.slice(c, c + cols) })))
  }
  const heightOf = (g: Item[]) => g[0].kind === 'blank' ? lh * 0.55 : g[0].kind === 'section' ? 26 : g[0].kind === 'note' ? lh : lh * g.length

  let col = 0, y = top0, top = top0
  const x0 = () => M + col * (colW + gap)
  const advance = (need: number) => {
    if (y + need <= bottom) return
    if (twoCols && col === 0) { col = 1; y = top; return }
    d.addPage(); col = 0; top = drawRunningHead(d, meta.title); y = top
  }
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    if (g[0].kind === 'blank') { if (y > top) y += heightOf(g); continue }
    // a etiqueta da seção nunca fica sozinha no pé da coluna
    const need = g[0].kind === 'section' ? heightOf(g) + (groups[gi + 1] ? heightOf(groups[gi + 1]) : 0) : heightOf(g)
    advance(need)
    if (g[0].kind === 'note') { d.setFont('helvetica', 'oblique'); d.setFontSize(9); ink.color(d, [168, 92, 20]); d.text('» ' + g[0].text, x0(), y + 8); y += lh; continue }
    if (g[0].kind === 'section') {
      const label = g[0].text.replace(/[[\]]/g, '').toUpperCase()
      d.setFont('helvetica', 'bold'); d.setFontSize(8.5)
      const w = d.getTextWidth(label) + 16
      ink.fill(d, C.cream); ink.stroke(d, C.gold); d.setLineWidth(0.8)
      d.roundedRect(x0(), y - 2, w, 15, 7.5, 7.5, 'FD')
      ink.color(d, C.goldDeep); d.text(label, x0() + 8, y + 8.6)
      y += 26
      continue
    }
    for (const p of g) {
      if (p.kind === 'chord') { d.setFont('courier', 'bold'); ink.color(d, C.goldDeep) } else { d.setFont('courier', 'normal'); ink.color(d, C.ink) }
      d.setFontSize(size)
      d.text(p.text, x0(), y + size * 0.8); y += lh
    }
  }

  // acordes usados (desenho do violão)
  const used: string[] = []
  for (const r of rows) if (r.kind === 'chord') for (const n of r.text.split(/\s+/)) if (n && !used.includes(n)) used.push(n)
  const shapes = used.map((n) => ({ n, s: chordShape(n, 'violao') })).filter((x) => x.s)
  if (shapes.length) {
    const cw = 76, ch = 104, per = Math.floor((W - 2 * M + 10) / (cw + 10))
    const needTitle = 30
    if (col === 1 || y + needTitle + ch > bottom) { d.addPage(); top = drawRunningHead(d, meta.title); y = top } else y += 14
    col = 0
    d.setFont('helvetica', 'bold'); d.setFontSize(11); ink.color(d, C.ink)
    d.text('Acordes usados', M, y + 8)
    ink.stroke(d, C.gold); d.setLineWidth(1); d.line(M, y + 14, M + 110, y + 14)
    y += needTitle
    shapes.forEach((x, i) => {
      if (i % per === 0 && i > 0) y += ch + 10
      if (y + ch > bottom) { d.addPage(); top = drawRunningHead(d, meta.title); y = top }
      drawChordBox(d, x.n, x.s!, M + (i % per) * (cw + 10), y, cw, ch)
    })
  }

}

function drawChordBox(d: jsPDF, name: string, s: Shape, x: number, y: number, w: number, h: number) {
  ink.fill(d, [250, 247, 240]); ink.stroke(d, C.line); d.setLineWidth(0.6)
  d.roundedRect(x, y, w, h, 6, 6, 'FD')
  d.setFont('courier', 'bold'); d.setFontSize(11); ink.color(d, C.goldDeep)
  d.text(name, x + w / 2, y + 15, { align: 'center' })
  const gx = x + 14, gy = y + 32, gw = w - 28, gh = 58, strings = 6, frets = 5
  const sx = (i: number) => gx + (gw * i) / (strings - 1)
  const fy = (f: number) => gy + (gh * (f - 0.5)) / frets
  ink.stroke(d, [150, 160, 185]); d.setLineWidth(0.5)
  for (let f = 0; f <= frets; f++) d.line(gx, gy + (gh * f) / frets, gx + gw, gy + (gh * f) / frets)
  for (let i = 0; i < strings; i++) d.line(sx(i), gy, sx(i), gy + gh)
  if (s.baseFret === 1) { ink.fill(d, C.ink); d.rect(gx - 0.5, gy - 2.5, gw + 1, 2.5, 'F') }
  else { d.setFont('helvetica', 'normal'); d.setFontSize(7); ink.color(d, C.muted); d.text(String(s.baseFret), gx - 9, fy(1) + 2.5) }
  const rel = (f: number) => f - s.baseFret + 1
  ink.fill(d, C.goldDeep)
  if (s.barre) d.roundedRect(sx(s.barre.from) - 3, fy(rel(s.barre.fret)) - 3, sx(s.barre.to) - sx(s.barre.from) + 6, 6, 3, 3, 'F')
  s.frets.forEach((f, i) => {
    if (f < 0) { d.setFont('helvetica', 'normal'); d.setFontSize(7); ink.color(d, C.muted); d.text('×', sx(i), gy - 5, { align: 'center' }); return }
    if (f === 0) { ink.stroke(d, C.muted); d.setLineWidth(0.7); d.circle(sx(i), gy - 7, 2.2, 'S'); return }
    if (s.barre && f === s.barre.fret && i >= s.barre.from && i <= s.barre.to) return
    ink.fill(d, C.goldDeep); d.circle(sx(i), fy(rel(f)), 3.4, 'F')
  })
}

export function printCifra(blocks: CifraBlock[], meta: ExportMeta, layers: Layers) {
  const rows = cifraToRows(blocks, layers)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const body = rows.map((r) => r.kind === 'blank' ? '<div class="b"></div>' : `<div class="${r.kind}">${esc(r.text) || '&nbsp;'}</div>`).join('')
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(meta.title)}</title><style>
    body{font-family:ui-monospace,Menlo,Consolas,monospace;margin:32px;color:#111}
    h1{font-family:system-ui,sans-serif;margin:0 0 4px;font-size:22px}.meta{font-family:system-ui,sans-serif;color:#555;font-size:12px;margin-bottom:20px}
    div{white-space:pre;font-size:13px;line-height:1.35}.chord{color:#1c3466;font-weight:700}.section{font-family:system-ui,sans-serif;font-weight:700;color:#1c3466;margin-top:8px;text-transform:uppercase;font-size:11px;letter-spacing:.06em}.b{height:10px}
  </style></head><body><h1>${esc(meta.title)}</h1><div class="meta">${esc(header(meta))}</div>${body}<script>window.onload=()=>{window.print()}<\/script></body></html>`)
  w.document.close()
}
