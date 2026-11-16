import { chordShape, keyboardNotes, type Instrument, type Shape } from '../lib/diagrams'

export function ChordDiagram({ name, instrument, active = false, shape }: { name: string; instrument: Instrument; active?: boolean; shape?: Shape | null }) {
  return (
    <figure className={`flex flex-col items-center rounded-r4 border px-2 pb-2 pt-1.5 transition ${active ? 'border-gold/70 bg-gold/10' : 'border-n3 bg-n2'}`}>
      <figcaption className={`font-mono text-[15px] font-semibold ${active ? 'text-gold' : 'text-n12'}`}>{name}</figcaption>
      {instrument === 'teclado' ? <Keyboard name={name} /> : <Fretboard name={name} instrument={instrument} override={shape} />}
    </figure>
  )
}

function Fretboard({ name, instrument, override }: { name: string; instrument: 'violao' | 'ukulele'; override?: Shape | null }) {
  const shape = override ?? chordShape(name, instrument)
  const strings = instrument === 'violao' ? 6 : 4
  const W = 84, H = 96, x0 = 14, y0 = 18, gw = W - 24, gh = 68
  const sx = (i: number) => x0 + (gw * i) / (strings - 1)
  const fy = (f: number) => y0 + (gh * (f - 0.5)) / 5
  if (!shape) return <div className="grid h-[96px] w-[84px] place-items-center text-[11px] text-n9">sem desenho</div>
  const rel = (f: number) => f - shape.baseFret + 1
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Desenho de ${name}`}>
      {shape.baseFret === 1 ? <rect x={x0 - 1} y={y0 - 3} width={gw + 2} height={3} fill="#f3e6c8" rx={1} /> : <text x={2} y={fy(1) + 3} fontSize={9} fill="#c4b48f" fontFamily="Inter Variable, sans-serif">{shape.baseFret}</text>}
      {Array.from({ length: 6 }, (_, f) => <line key={f} x1={x0} x2={x0 + gw} y1={y0 + (gh * f) / 5} y2={y0 + (gh * f) / 5} stroke="#3d5385" strokeWidth={1} />)}
      {Array.from({ length: strings }, (_, s) => <line key={s} x1={sx(s)} x2={sx(s)} y1={y0} y2={y0 + gh} stroke="#6a7ca3" strokeWidth={1} />)}
      {shape.barre && <rect x={sx(shape.barre.from) - 4} y={fy(rel(shape.barre.fret)) - 4} width={sx(shape.barre.to) - sx(shape.barre.from) + 8} height={8} rx={4} fill="#e8b437" />}
      {shape.frets.map((f, s) => {
        if (f < 0) return <text key={s} x={sx(s)} y={y0 - 6} fontSize={9} textAnchor="middle" fill="#8090b3" fontFamily="sans-serif">×</text>
        if (f === 0) return <circle key={s} cx={sx(s)} cy={y0 - 8} r={2.8} fill="none" stroke="#c4b48f" strokeWidth={1.2} />
        if (shape.barre && f === shape.barre.fret && s >= shape.barre.from && s <= shape.barre.to) return null
        return <circle key={s} cx={sx(s)} cy={fy(rel(f))} r={4.5} fill="#e8b437" />
      })}
    </svg>
  )
}

function Keyboard({ name }: { name: string }) {
  const k = keyboardNotes(name)
  const start = 48 // C3
  const whites: number[] = []
  for (let m = start; m < start + 36; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m)
  const ww = 6.5, H = 46
  const W = whites.length * ww
  const on = new Set(k?.midi ?? [])
  const blackX = (m: number) => whites.indexOf(m - 1) * ww + ww - 2
  return (
    <svg width={W} height={H + 4} viewBox={`0 0 ${W} ${H + 4}`} className="mt-2" role="img" aria-label={`Teclado de ${name}`}>
      {whites.map((m, i) => <rect key={m} x={i * ww} y={0} width={ww - 0.6} height={H} rx={1.2} fill={on.has(m) ? '#e8b437' : m === k?.bass ? '#6fb6ff' : '#f3e6c8'} />)}
      {Array.from({ length: 36 }, (_, i) => start + i).filter((m) => [1, 3, 6, 8, 10].includes(m % 12)).map((m) => (
        <rect key={m} x={blackX(m)} y={0} width={4} height={H * 0.6} rx={0.8} fill={on.has(m) ? '#c9941f' : m === k?.bass ? '#6fb6ff' : '#13213f'} />
      ))}
    </svg>
  )
}
