// Identidade visual dos PDFs do Josué: faixa azul-noite com o ícone e o título em dourado,
// etiquetas (tom, BPM…), rodapé com o crédito do criador e numeração de páginas.
import type { jsPDF } from 'jspdf'

export const C = {
  navy: [14, 26, 51] as const,
  navy2: [25, 42, 76] as const,
  ink: [19, 33, 63] as const,
  muted: [96, 110, 140] as const,
  gold: [232, 180, 55] as const,
  goldDeep: [168, 116, 15] as const,
  goldLight: [255, 236, 170] as const,
  cream: [253, 246, 228] as const,
  line: [220, 210, 185] as const,
}
export const CREDIT = 'Josué · Criado por Flávio Lúcio Curado · 2026'
export const M = 40 // margem

let logoCache: string | null | undefined
export async function loadLogo(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache
  try {
    const blob = await (await fetch('./img/josue-96.png')).blob()
    logoCache = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(blob) })
  } catch { logoCache = null }
  return logoCache
}

const fill = (d: jsPDF, c: readonly number[]) => d.setFillColor(c[0], c[1], c[2])
const stroke = (d: jsPDF, c: readonly number[]) => d.setDrawColor(c[0], c[1], c[2])
const color = (d: jsPDF, c: readonly number[]) => d.setTextColor(c[0], c[1], c[2])
export const ink = { fill, stroke, color }

/** Cabeçalho grande da 1ª página. Devolve o y onde o conteúdo começa. */
export function drawCover(d: jsPDF, logo: string | null, title: string, subtitle: string, chips: string[]): number {
  const W = d.internal.pageSize.getWidth()
  const H = 104
  fill(d, C.navy); d.rect(0, 0, W, H, 'F')
  fill(d, C.gold); d.rect(0, H, W, 3, 'F')
  let x = M
  if (logo) {
    fill(d, C.gold); d.roundedRect(x - 2, 20, 64, 64, 10, 10, 'F')
    d.addImage(logo, 'PNG', x, 22, 60, 60)
    x += 78
  }
  d.setFont('times', 'bold'); d.setFontSize(24); color(d, C.goldLight)
  const t = d.splitTextToSize(title, W - x - M)[0] as string
  d.text(t, x, 46)
  d.setFont('helvetica', 'normal'); d.setFontSize(10); color(d, [196, 180, 143])
  d.text(subtitle, x, 62)
  // etiquetas
  let cx = x
  d.setFontSize(9)
  for (const chip of chips) {
    const w = d.getTextWidth(chip) + 14
    fill(d, C.navy2); stroke(d, [70, 89, 138]); d.setLineWidth(0.6)
    d.roundedRect(cx, 70, w, 17, 8.5, 8.5, 'FD')
    color(d, [243, 230, 200]); d.text(chip, cx + 7, 81.5)
    cx += w + 6
  }
  return H + 28
}

/** Cabeçalho discreto das páginas seguintes. Devolve o y do conteúdo. */
export function drawRunningHead(d: jsPDF, title: string): number {
  const W = d.internal.pageSize.getWidth()
  d.setFont('times', 'bold'); d.setFontSize(11); color(d, C.ink)
  d.text(title, M, 30)
  d.setFont('helvetica', 'normal'); d.setFontSize(8); color(d, C.muted)
  d.text('Josué', W - M, 30, { align: 'right' })
  stroke(d, C.gold); d.setLineWidth(1); d.line(M, 37, W - M, 37)
  return 58
}

/** Rodapé em todas as páginas (chamar no fim, quando o total de páginas já é conhecido). */
export function drawFooters(d: jsPDF) {
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight()
  const n = d.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    d.setPage(p)
    stroke(d, C.line); d.setLineWidth(0.6); d.line(M, H - 32, W - M, H - 32)
    d.setFont('helvetica', 'normal'); d.setFontSize(8); color(d, C.muted)
    d.text(CREDIT, M, H - 20)
    d.text(`Página ${p} de ${n}`, W - M, H - 20, { align: 'right' })
  }
}

export const FOOTER_SPACE = 44
