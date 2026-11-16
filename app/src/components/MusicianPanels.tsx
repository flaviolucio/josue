// Painéis do músico: escalas no braço (9), "tocou certo?" pelo microfone (1) e cifra em compassos (3).
import { useEffect, useMemo, useRef, useState } from 'react'
import { IClose } from './Icons'
import { chordPitchClasses, noteName } from '../lib/chords'
import { SCALES, keyInfo, type Bar } from '../lib/theory'
import { formatTime } from '../lib/audio'

// ---------------- 9. escalas ----------------
const STRINGS = [4, 11, 7, 2, 9, 4] // de cima (1ª corda, Mi agudo) para baixo, como no desenho de braço
const FRETS = 15

export function ScalePanel({ songKey, chord, flats, onClose }: { songKey: string; chord: string; flats: boolean; onClose: () => void }) {
  const ki = keyInfo(songKey)
  const [scale, setScale] = useState<string>(ki.minor ? 'pentaMenor' : 'pentaMaior')
  const [root, setRoot] = useState(ki.root)
  useEffect(() => { setRoot(keyInfo(songKey).root) }, [songKey])
  const sc = SCALES[scale]
  const inScale = new Set(sc.iv.map((i) => (root + i) % 12))
  const chordPcs = new Set(chordPitchClasses(chord)?.pcs ?? [])
  const W = 760, H = 150, x0 = 28, fw = (W - x0 - 10) / FRETS, sy = (i: number) => 16 + i * 22
  const fx = (f: number) => (f === 0 ? x0 - 12 : x0 + (f - 0.5) * fw)
  return (
    <div className="splash-in fixed inset-x-2 bottom-[118px] z-40 mx-auto max-w-[820px] rounded-[18px] border-2 border-gold/70 bg-n1/95 p-3 shadow-[0_12px_50px_#000c] backdrop-blur-md" role="dialog" aria-label="Escalas">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-caption font-semibold uppercase tracking-wider text-n11">Escalas para solar</p>
        <select value={scale} onChange={(e) => setScale(e.target.value)} className="h-8 rounded-r4 border border-n5 bg-n2 px-2 text-caption text-n12">
          {Object.entries(SCALES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>
        <select value={root} onChange={(e) => setRoot(Number(e.target.value))} aria-label="Tônica" className="h-8 rounded-r4 border border-n5 bg-n2 px-2 text-caption text-n12">
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{noteName(i, flats)}</option>)}
        </select>
        <span className="text-caption text-n10">Tom da música: <b className="text-gold">{songKey || '–'}</b>{chord && <> · agora: <b className="font-mono text-gold">{chord}</b> (círculo = nota do acorde)</>}</span>
        <button onClick={onClose} aria-label="Fechar" className="ml-auto grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={16} /></button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${sc.name} de ${noteName(root, flats)}`}>
        <rect x={x0} y={sy(0)} width={W - x0 - 10} height={sy(5) - sy(0)} fill="#0e1a33" />
        {Array.from({ length: FRETS + 1 }, (_, f) => <line key={f} x1={x0 + f * fw} x2={x0 + f * fw} y1={sy(0)} y2={sy(5)} stroke={f === 0 ? '#f3e6c8' : '#3d5385'} strokeWidth={f === 0 ? 3 : 1} />)}
        {[3, 5, 7, 9, 15].map((f) => <circle key={f} cx={x0 + (f - 0.5) * fw} cy={(sy(2) + sy(3)) / 2} r={3} fill="#253a65" />)}
        <circle cx={x0 + 11.5 * fw} cy={sy(1) + 11} r={3} fill="#253a65" /><circle cx={x0 + 11.5 * fw} cy={sy(3) + 11} r={3} fill="#253a65" />
        {STRINGS.map((_, i) => <line key={i} x1={x0} x2={W - 10} y1={sy(i)} y2={sy(i)} stroke="#6a7ca3" strokeWidth={0.8 + i * 0.25} />)}
        {Array.from({ length: FRETS + 1 }, (_, f) => f > 0 && <text key={f} x={x0 + (f - 0.5) * fw} y={H - 6} fontSize={9} fill="#8090b3" textAnchor="middle">{f}</text>)}
        {STRINGS.map((open, s) => Array.from({ length: FRETS + 1 }, (_, f) => {
          const pc = (open + f) % 12
          if (!inScale.has(pc)) return null
          const isRoot = pc === root, inChord = chordPcs.has(pc)
          return (
            <g key={s + '-' + f}>
              <circle cx={fx(f)} cy={sy(s)} r={8} fill={isRoot ? '#e8b437' : '#2e4473'} stroke={inChord ? '#6fb6ff' : 'none'} strokeWidth={inChord ? 2.5 : 0} />
              <text x={fx(f)} y={sy(s) + 3} fontSize={8} fontWeight={700} textAnchor="middle" fill={isRoot ? '#0e1a33' : '#f3e6c8'}>{noteName(pc, flats)}</text>
            </g>
          )
        }))}
      </svg>
      <p className="mt-1 text-[11px] text-n9">Dourado = tônica da escala · círculo azul = nota do acorde que está tocando (alvo seguro para terminar frases).</p>
    </div>
  )
}

// ---------------- 1. tocou certo? ----------------
export type Marks = Map<number, 'ok' | 'bad'>
/** Ouve o microfone e compara com o acorde que deveria estar soando. */
export function useChordCheck(on: boolean, chordIndex: number, soundingName: (i: number) => string, playing: boolean) {
  const [marks, setMarks] = useState<Marks>(new Map())
  const [live, setLive] = useState<{ match: number; level: number; active: boolean }>({ match: 0, level: 0, active: false })
  // sensibilidade 1–10 (lembrada): quanto maior, mais baixo o som do violão que ele aceita
  const [sens, setSensState] = useState(() => { try { return Number(localStorage.getItem('josue.checkSens')) || 8 } catch { return 8 } })
  const sensRef = useRef(sens); sensRef.current = sens
  const setSens = (v: number) => { setSensState(v); try { localStorage.setItem('josue.checkSens', String(v)) } catch { /* */ } }
  const [err, setErr] = useState('')
  const acc = useRef(new Map<number, { hit: number; n: number }>())
  const cur = useRef({ i: chordIndex, playing, name: soundingName })
  cur.current = { i: chordIndex, playing, name: soundingName }
  // fecha o acorde anterior quando a música passa para o próximo
  const lastIdx = useRef(-1)
  useEffect(() => {
    if (!on) return
    const prev = lastIdx.current
    lastIdx.current = chordIndex
    if (prev < 0 || prev === chordIndex) return
    const a = acc.current.get(prev)
    if (a && a.n >= 3) setMarks((m) => new Map(m).set(prev, a.hit / a.n >= 0.45 ? 'ok' : 'bad'))
  }, [chordIndex, on])
  useEffect(() => {
    if (!on) return
    let stream: MediaStream | null = null, ctx: AudioContext | null = null, timer = 0, stop = false
    void (async () => {
      try {
        // mesmo microfone escolhido no afinador (se houver)
        let mic = ''
        try { mic = localStorage.getItem('josue.tuner.mic') || '' } catch { /* */ }
        const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { ...constraints, deviceId: { exact: mic } } : constraints }) }
        catch { stream = await navigator.mediaDevices.getUserMedia({ audio: constraints }) }
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return }
        ctx = new AudioContext()
        const an = ctx.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.5
        ctx.createMediaStreamSource(stream).connect(an)
        const spec = new Float32Array(an.frequencyBinCount)
        const wave = new Float32Array(an.fftSize)
        const binHz = ctx.sampleRate / an.fftSize
        const k0 = Math.ceil(70 / binHz), k1 = Math.min(spec.length - 1, Math.floor(1500 / binHz))
        timer = window.setInterval(() => {
          // volume (como no afinador): o portão depende da sensibilidade escolhida
          an.getFloatTimeDomainData(wave)
          let rms = 0; for (const v of wave) rms += v * v
          rms = Math.sqrt(rms / wave.length)
          const level = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 70) / 60))
          const gate = 0.01 * 10 ** (-sensRef.current / 4)
          const active = rms >= gate
          // notas = só os picos que se destacam do ruído de fundo
          an.getFloatFrequencyData(spec)
          const sorted = Array.from(spec.subarray(k0, k1)).sort((a, b) => a - b)
          const floor = sorted[Math.floor(sorted.length / 2)] ?? -100
          const chroma = new Float32Array(12)
          for (let k = k0 + 1; k < k1; k++) {
            const db = spec[k]
            if (db < floor + 10 || db < spec[k - 1] || db < spec[k + 1]) continue // não é pico
            const mag = 10 ** ((db - floor) / 20)
            const midi = 69 + 12 * Math.log2((k * binHz) / 440)
            chroma[((Math.round(midi) % 12) + 12) % 12] += mag
          }
          const { i, playing: pl, name } = cur.current
          if (i < 0) { setLive({ match: 0, level, active }); return }
          const pcs = chordPitchClasses(name(i))?.pcs ?? []
          const sum = chroma.reduce((a, b) => a + b, 0)
          const inChord = pcs.reduce((a, p) => a + chroma[p], 0)
          const share = sum ? inChord / sum : 0
          const expected = pcs.length / 12
          let match = sum ? Math.max(0, Math.min(1, ((share - expected) / (1 - expected)) * 1.6)) : 0
          // maior x menor: a terça certa precisa soar mais que a "outra" terça (G x Gm, D x Dm…)
          const info = chordPitchClasses(name(i))
          if (info) {
            const M3 = (info.root + 4) % 12, m3 = (info.root + 3) % 12
            const want = pcs.includes(M3) ? M3 : pcs.includes(m3) ? m3 : -1
            const other = want === M3 ? m3 : want === m3 ? M3 : -1
            if (want >= 0 && chroma[other] > chroma[want] * 1.15) match *= 0.3
          }
          setLive({ match, level, active })
          if (!pl || !active) return
          const a = acc.current.get(i) ?? { hit: 0, n: 0 }
          a.n++; if (match >= 0.5) a.hit++
          acc.current.set(i, a)
        }, 100)
      } catch (e) { setErr((e as DOMException)?.name === 'NotAllowedError' ? 'Microfone bloqueado. Libere nas permissões do navegador.' : String((e as Error).message)) }
    })()
    return () => { stop = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close() }
  }, [on])
  const reset = () => { acc.current.clear(); setMarks(new Map()) }
  const ok = [...marks.values()].filter((v) => v === 'ok').length
  return { marks, live, err, reset, sens, setSens, score: marks.size ? Math.round((ok / marks.size) * 100) : null, counted: marks.size }
}

export function ChordCheckPanel({ chord, live, score, counted, err, onReset, onClose, sens, setSens }: { chord: string; live: { match: number; level: number; active: boolean }; score: number | null; counted: number; err: string; onReset: () => void; onClose: () => void; sens: number; setSens: (v: number) => void }) {
  const good = live.match >= 0.5 && live.active
  return (
    <div className="splash-in fixed bottom-[118px] left-3 z-40 w-[260px] rounded-[18px] border-2 border-gold/70 bg-n1/95 p-3 shadow-[0_12px_50px_#000c] backdrop-blur-md md:left-6" role="dialog" aria-label="Tocou certo?">
      <div className="flex items-center justify-between">
        <p className="text-caption font-semibold uppercase tracking-wider text-n11">Tocou certo?</p>
        <button onClick={onClose} aria-label="Fechar" className="grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={16} /></button>
      </div>
      {err ? <p className="mt-2 text-caption text-amber">{err}</p> : (
        <>
          <div className={`mt-2 rounded-r4 py-3 text-center transition ${!live.active ? 'bg-n2' : good ? 'bg-[#1f9d5c]/30' : 'bg-error/20'}`}>
            <p className="font-mono text-[34px] font-bold text-n12">{chord || '–'}</p>
            <p className={`text-caption font-semibold ${!live.active ? 'text-n10' : good ? 'text-[#3ee08f]' : 'text-amber'}`}>{!live.active ? 'Toque junto com a música…' : good ? 'Certo! ✓' : 'Não bateu com o acorde'}</p>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-n10">Nível<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-n4"><div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${live.level * 100}%`, background: live.active ? 'var(--color-gold)' : 'var(--color-n8)' }} /></div></div>
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-n10">Sensibilidade <input type="range" min={1} max={10} value={sens} onChange={(e) => setSens(Number(e.target.value))} className="flex-1 accent-[#e8b437]" /> <b className="w-4 text-n12">{sens}</b></label>
          <div className="mt-2 flex items-center justify-between text-caption text-n11">
            <span>Precisão: <b className="text-gold">{score === null ? '–' : `${score}%`}</b> <span className="text-n9">({counted} acordes)</span></span>
            <button onClick={onReset} className="text-gold hover:underline">Zerar</button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-n9">Use <b className="text-n11">fones de ouvido</b>: assim o microfone ouve só o seu instrumento. Na cifra, os acordes ficam verdes (acertou) ou vermelhos (errou).</p>
        </>
      )}
    </div>
  )
}

// ---------------- 3. compassos ----------------
export function RhythmView({ bars, time, perRow, onSeek, display, fontSize }: { bars: Bar[]; time: number; perRow: number; onSeek: (t: number) => void; display: (c: string) => string; fontSize: number }) {
  const cur = useMemo(() => bars.findIndex((b) => time >= b.t0 && time < b.t1), [bars, time])
  useEffect(() => {
    if (cur < 0) return
    document.querySelector(`[data-bar="${cur}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [Math.floor(cur / perRow)]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!bars.length) return <p className="py-8 text-center text-sm2 text-n10">Não há batidas suficientes nesta música para montar os compassos.</p>
  const rows: { bars: Bar[]; start: number }[] = []
  bars.forEach((b, i) => {
    if (i % perRow === 0 || b.section) rows.push({ bars: [], start: i })
    rows[rows.length - 1].bars.push(b)
  })
  return (
    <div className="font-mono" style={{ fontSize }}>
      <p className="mb-4 font-sans text-caption text-n10">Cada caixa é um compasso; cada posição é um tempo. “·” = o acorde continua. Clique num compasso para tocar dali.</p>
      {rows.map((r, ri) => (
        <div key={ri}>
          {r.bars[0].section && <p className="mb-1 mt-4 font-sans text-[12px] font-semibold uppercase tracking-wider text-gold">{r.bars[0].section} <span className="font-mono font-normal text-n9">{formatTime(r.bars[0].t0)}</span></p>}
          <div className="mb-1.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
            {r.bars.map((b, k) => {
              const i = r.start + k, on = i === cur
              return (
                <button key={i} data-bar={i} onClick={() => onSeek(b.t0)} className={`flex items-center justify-around rounded-r3 border px-1 py-2 transition ${on ? 'border-gold bg-gold/15' : 'border-n5 bg-n2/60 hover:border-n7'}`}>
                  {b.slots.map((s, j) => <span key={j} className={s && s !== '.' ? `font-bold ${on ? 'text-gold-100' : 'text-gold'}` : 'text-n8'}>{s === '.' ? '·' : s ? display(s) : '–'}</span>)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
