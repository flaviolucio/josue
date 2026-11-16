// Batida sugerida (padrão de mão direita) a partir do compasso e do andamento, e um metrônomo
// que segue as batidas detectadas na música.

export interface Strum { pattern: string; name: string; tip: string }

export function suggestStrum(timeSig: string, bpm: number): Strum {
  if (timeSig === '3/4') return { pattern: '↓  ↓↑ ↓↑', name: 'Valsa / guarânia', tip: 'Baixo forte no 1, acompanhamento no 2 e no 3.' }
  if (timeSig === '6/8') return { pattern: '↓ ↓↑ ↓ ↓↑', name: 'Balada em 6/8', tip: 'Dois tempos fortes por compasso (1 e 4).' }
  if (bpm && bpm < 75) return { pattern: '↓   ↓   ↓↑ ↓', name: 'Balada lenta', tip: 'Deixe soar; capriche na dinâmica.' }
  if (bpm && bpm > 120) return { pattern: '↓↑↓↑ ↓↑↓↑', name: 'Rock / colcheias', tip: 'Palhetada alternada constante; abafe com a palma (palm mute) nas partes pesadas.' }
  return { pattern: '↓  ↓↑  ↑↓↑', name: 'Pop / folk (a mais usada)', tip: 'Mantenha a mão sempre se mexendo, mesmo quando não toca as cordas.' }
}

let ctx: AudioContext | null = null
/** Clique do metrônomo (acento no 1º tempo do compasso). */
export function click(accent: boolean, volume = 0.6) {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  const t = ctx.currentTime
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = 'square'
  o.frequency.value = accent ? 1760 : 1175
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(volume * (accent ? 0.5 : 0.3), t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  o.connect(g).connect(ctx.destination)
  o.start(t); o.stop(t + 0.07)
}

/** Batidas da música: as detectadas na análise ou, sem elas, uma grade pelo BPM. */
export function beatGrid(beats: number[] | undefined, bpm: number, duration: number): number[] {
  if (beats && beats.length > 8) return beats
  const step = 60 / (bpm || 100)
  const out: number[] = []
  for (let t = 0; t < duration; t += step) out.push(t)
  return out
}

/** Dedilhado sugerido (P = polegar no baixo; i, m, a = indicador, médio e anelar nas cordas 3, 2 e 1). */
export interface Picking { pattern: string[]; name: string; tip: string }
export function suggestPicking(timeSig: string, bpm: number): Picking {
  const tip = 'P = polegar na corda do baixo do acorde · i = indicador (3ª corda) · m = médio (2ª) · a = anelar (1ª)'
  if (timeSig === '3/4') return { pattern: ['P', 'i', 'm', 'a', 'm', 'i'], name: 'Arpejo em 3', tip }
  if (timeSig === '6/8') return { pattern: ['P', 'i', 'm', 'a', 'm', 'i'], name: 'Arpejo em 6/8', tip }
  if (bpm && bpm > 110) return { pattern: ['P', 'i', 'm', 'i', 'P', 'i', 'm', 'i'], name: 'Arpejo rápido', tip }
  return { pattern: ['P', 'i', 'm', 'a', 'P', 'i', 'm', 'a'], name: 'Arpejo de balada', tip }
}
