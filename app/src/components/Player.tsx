import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { formatTime } from '../lib/audio'
import { IBack5, IFwd5, IPause, IPlay, IRepeat } from './Icons'

export const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5]

interface Props {
  audio: HTMLAudioElement
  url: string
  time: number
  duration: number
  playing: boolean
  speed: number
  setSpeed: (s: number) => void
  loop: { a: number | null; b: number | null }
  onLoop: () => void
  peaksReady?: () => void
}

export default function Player({ audio, url, time, duration, playing, speed, setSpeed, loop, onLoop }: Props) {
  const waveRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!waveRef.current) return
    const ws = WaveSurfer.create({
      container: waveRef.current,
      media: audio,
      url,
      height: 36,
      waveColor: '#7a5f24',
      progressColor: '#ffd873',
      cursorColor: '#f3e6c8',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
    })
    return () => ws.destroy()
  }, [audio, url])

  const seek = (t: number) => { audio.currentTime = Math.max(0, Math.min(duration || audio.duration || 0, t)) }
  const toggle = () => (audio.paused ? void audio.play() : audio.pause())
  const btn = 'grid h-10 w-10 place-items-center rounded-full text-n11 transition hover:bg-n4 hover:text-n12'
  const loopLabel = loop.a === null ? 'Loop A-B: marcar início (A)' : loop.b === null ? 'Loop A-B: marcar fim (B)' : 'Desligar loop A-B'
  const d = duration || 1

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-gold/30 bg-n1/60 backdrop-blur-md" role="region" aria-label="Player">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-1 px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:px-6">
        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-n11">{formatTime(time)}</span>
          <div className="relative min-w-0 flex-1">
            <div ref={waveRef} className="w-full" />
            {loop.a !== null && (
              <div className="pointer-events-none absolute inset-y-0 rounded-r2 border-x-2 border-amber bg-amber/15" style={{ left: `${(loop.a / d) * 100}%`, width: loop.b !== null ? `${((loop.b - loop.a) / d) * 100}%` : '2px' }} />
            )}
          </div>
          <span className="w-10 shrink-0 font-mono text-[12px] tabular-nums text-n10">{formatTime(duration)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-caption text-n10" title="Velocidade (sem mudar o tom)">
            <span className="hidden sm:inline">Velocidade</span>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 rounded-r4 border border-n4 bg-n1 px-1.5 font-mono text-[12px] text-n12 outline-none" aria-label="Velocidade">
              {SPEEDS.map((s) => <option key={s} value={s}>{s.toFixed(2).replace(/0$/, '')}x</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1 sm:gap-2">
            <button className={btn} onClick={() => seek(audio.currentTime - 5)} aria-label="Voltar 5 segundos" title="Voltar 5 s (←)"><IBack5 size={22} /></button>
            <button onClick={toggle} aria-label={playing ? 'Pausar' : 'Tocar'} title="Tocar/pausar (espaço)" className="gold-btn grid h-14 w-14 place-items-center rounded-full text-n1 transition hover:scale-105">
              {playing ? <IPause size={22} /> : <IPlay size={22} className="translate-x-[1px]" />}
            </button>
            <button className={btn} onClick={() => seek(audio.currentTime + 5)} aria-label="Avançar 5 segundos" title="Avançar 5 s (→)"><IFwd5 size={22} /></button>
          </div>
          <button onClick={onLoop} title={loopLabel} aria-label={loopLabel} className={`flex h-8 items-center gap-1.5 rounded-r4 px-2 text-caption font-semibold transition ${loop.a !== null ? 'bg-amber/15 text-amber' : 'text-n10 hover:bg-n4 hover:text-n12'}`}>
            <IRepeat size={16} />
            <span className="font-mono">{loop.a === null ? 'A-B' : loop.b === null ? `A ${formatTime(loop.a)}` : `${formatTime(loop.a)}–${formatTime(loop.b)}`}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
