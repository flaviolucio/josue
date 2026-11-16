// PDF da tablatura: desenha a música INTEIRA numa área fora da tela (sem o carregamento
// preguiçoso da tela, que só desenha o que está visível), em tinta preta sobre branco,
// e monta as páginas com a identidade do Josué — sem cabeçalho/rodapé do navegador.
import * as alphaTab from '@coderline/alphatab'
import { jsPDF } from 'jspdf'
import { FOOTER_SPACE, M, drawCover, drawFooters, drawRunningHead, loadLogo } from './pdfBrand'

const RENDER_W = 840 // px de largura da área de desenho (menor = notas maiores no papel)

/** Garante a fonte musical (Bravura, registrada como "alphaTab") antes de desenhar. */
export async function ensureMusicFont() {
  if ([...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'alphaTab' && f.status === 'loaded')) return
  try {
    const ff = new FontFace('alphaTab', `url(${new URL('./font/Bravura.woff2', document.baseURI).href}) format("woff2")`)
    await Promise.race([ff.load(), new Promise((_, bad) => setTimeout(() => bad(new Error('timeout')), 15000))])
    document.fonts.add(ff)
  } catch { /* o alphaTab tenta carregar sozinho */ }
}

/** Origem do desenho: texto alphaTex (tablatura gerada pelo Josué) ou um arquivo importado + faixas. */
export async function exportTabPdf(opts: { tex?: string; bytes?: Uint8Array; tracks?: number[]; title: string; subtitle: string; chips: string[]; fileName: string }) {
  await ensureMusicFont()
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${RENDER_W}px;background:#fff;`
  document.body.appendChild(host)
  let api: alphaTab.AlphaTabApi | null = null
  try {
    api = new alphaTab.AlphaTabApi(host, {
      core: { fontDirectory: new URL('./font/', document.baseURI).href, useWorkers: false, engine: 'html5', enableLazyLoading: false },
      display: { layoutMode: 'page', scale: 1, padding: [10, 10, 10, 10], resources: { barNumberColor: '#566a96' } },
      notation: { elements: { scoreTitle: false, scoreSubTitle: false, scoreArtist: false, scoreWordsAndMusic: false, guitarTuning: true, chordDiagrams: false } },
      player: { playerMode: alphaTab.PlayerMode.Disabled },
    } as unknown as alphaTab.json.SettingsJson)
    const done = new Promise<void>((ok, bad) => {
      const t = setTimeout(() => bad(new Error('A tablatura demorou demais para desenhar.')), 60000)
      api!.postRenderFinished.on(() => { clearTimeout(t); ok() })
      api!.error.on((e) => { clearTimeout(t); bad(e as unknown as Error) })
    })
    if (opts.bytes) api.load(opts.bytes, opts.tracks ?? [0])
    else api.tex(opts.tex ?? '')
    await done
    await new Promise((r) => setTimeout(r, 50))

    // cada pedaço desenhado é um <canvas> posicionado; agrupa por linha (mesma altura)
    const base = host.getBoundingClientRect()
    const parts = [...host.querySelectorAll('canvas')].map((c) => {
      const r = c.getBoundingClientRect()
      return { c, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
    }).filter((p) => p.w > 0 && p.h > 0).sort((a, b) => a.y - b.y || a.x - b.x)
    if (!parts.length) throw new Error('Nada foi desenhado.')
    const rows: { y: number; h: number; items: typeof parts }[] = []
    for (const p of parts) {
      const row = rows.find((r) => Math.abs(r.y - p.y) < 2)
      if (row) { row.items.push(p); row.h = Math.max(row.h, p.h) } else rows.push({ y: p.y, h: p.h, items: [p] })
    }

    const d = new jsPDF({ unit: 'pt', format: 'a4' })
    const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight()
    const k = (W - 2 * M) / RENDER_W
    const bottom = H - FOOTER_SPACE - 6
    let y = drawCover(d, await loadLogo(), opts.title, opts.subtitle, opts.chips)
    for (const row of rows) {
      const h = row.h * k
      if (y + h > bottom) { d.addPage(); y = drawRunningHead(d, opts.title) }
      for (const p of row.items) d.addImage(p.c.toDataURL('image/png'), 'PNG', M + p.x * k, y + (p.y - row.y) * k, p.w * k, p.h * k, undefined, 'FAST')
      y += h
    }
    drawFooters(d)
    d.save(opts.fileName)
  } finally {
    try { api?.destroy() } catch { /* ignore */ }
    host.remove()
  }
}
