// Mixer de faixas separadas (Demucs). O <audio> principal continua sendo o relógio;
// quando a mixagem sai do padrão, ele é silenciado e as faixas tocam sincronizadas a ele.
import { useEffect, useMemo, useRef, useState } from 'react'
import { stemUrl } from '../lib/api'
import type { Stems } from '../lib/types'
import { IClose } from './Icons'

export interface StemState { vol: number; mute: boolean; solo: boolean }
export type MixState = Record<string, StemState>

const SILENT_RMS = 0.002 // faixas praticamente vazias ficam escondidas
const ORDER = ['vocals', 'guitar', 'piano', 'bass', 'drums', 'other']

export function visibleStems(stems?: Stems) {
  if (!stems) return []
  return [...stems.list].filter((s) => s.rms >= SILENT_RMS).sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))
}

const isDefault = (mix: MixState) => Object.values(mix).every((s) => s.vol === 1 && !s.mute && !s.solo)

/** Toca as faixas em sincronia com o áudio principal enquanto a mixagem não for a padrão. */
/** silent: cala a gravação inteira (ex.: tablatura tocando só o som das notas) */
export function useStemPlayer(master: HTMLAudioElement, stems: Stems | undefined, mix: MixState, silent = false) {
  const list = useMemo(() => visibleStems(stems), [stems])
  const els = useMemo(() => {
    const m: Record<string, HTMLAudioElement> = {}
    if (!stems) return m
    for (const s of list) {
      const a = new Audio()
      a.preload = 'auto'
      a.crossOrigin = 'anonymous'
      ;(a as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true
      a.src = stemUrl(stems.id, s.name)
      m[s.name] = a
    }
    return m
  }, [stems, list])
  const [error, setError] = useState(false)
  const active = !!stems && list.length > 0 && !isDefault(mix) && !error
  const activeRef = useRef(active); activeRef.current = active

  // volumes
  useEffect(() => {
    const anySolo = Object.values(mix).some((s) => s.solo)
    for (const [name, a] of Object.entries(els)) {
      const st = mix[name] ?? { vol: 1, mute: false, solo: false }
      a.volume = silent || st.mute || (anySolo && !st.solo) ? 0 : Math.min(1, st.vol)
    }
    master.muted = active || silent
  }, [mix, els, master, active, silent])

  // sincronia com o principal
  useEffect(() => {
    const all = Object.values(els)
    if (!all.length) return
    const onErr = () => setError(true)
    all.forEach((a) => a.addEventListener('error', onErr))
    const align = (force = false) => {
      for (const a of all) {
        a.playbackRate = master.playbackRate
        if (force || Math.abs(a.currentTime - master.currentTime) > 0.06) a.currentTime = master.currentTime
      }
    }
    const play = () => { if (!activeRef.current) return; align(true); all.forEach((a) => void a.play().catch(() => {})) }
    const pause = () => all.forEach((a) => a.pause())
    const seeked = () => { if (activeRef.current) align(true) }
    const rate = () => all.forEach((a) => (a.playbackRate = master.playbackRate))
    master.addEventListener('play', play)
    master.addEventListener('pause', pause)
    master.addEventListener('seeked', seeked)
    master.addEventListener('ratechange', rate)
    const timer = window.setInterval(() => { if (activeRef.current && !master.paused) align() }, 500)
    return () => {
      master.removeEventListener('play', play); master.removeEventListener('pause', pause)
      master.removeEventListener('seeked', seeked); master.removeEventListener('ratechange', rate)
      all.forEach((a) => { a.removeEventListener('error', onErr); a.pause() })
      window.clearInterval(timer)
    }
  }, [els, master])

  // liga/desliga as faixas quando a mixagem muda com a música tocando
  useEffect(() => {
    const all = Object.values(els)
    if (active && !master.paused) { all.forEach((a) => { a.currentTime = master.currentTime; a.playbackRate = master.playbackRate; void a.play().catch(() => {}) }) }
    if (!active) all.forEach((a) => a.pause())
  }, [active, els, master])

  useEffect(() => () => { master.muted = false; Object.values(els).forEach((a) => { a.pause(); a.src = '' }) }, [els, master])

  return { list, active, error }
}

interface Props {
  stems?: Stems
  mix: MixState
  setMix: (m: MixState) => void
  error: boolean
  onClose: () => void
}

export default function Mixer({ stems, mix, setMix, error, onClose }: Props) {
  const list = visibleStems(stems)
  const get = (n: string) => mix[n] ?? { vol: 1, mute: false, solo: false }
  const set = (n: string, patch: Partial<StemState>) => setMix({ ...mix, [n]: { ...get(n), ...patch } })
  const chip = (on: boolean, color: string) => `grid h-7 w-7 place-items-center rounded-r2 text-[12px] font-bold transition ${on ? color : 'bg-n4 text-n11 hover:bg-n5 hover:text-n12'}`

  return (
    <div className="no-print fixed bottom-[112px] right-3 z-50 w-[min(340px,calc(100vw-24px))] rounded-r6 border border-n4 bg-n2 p-4 shadow-2xl" role="dialog" aria-label="Faixas">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm2 font-medium text-n12">Faixas separadas</p>
        <div className="flex items-center gap-1">
          <button onClick={() => setMix({})} className="h-7 rounded-r4 px-2 text-caption text-n10 hover:bg-n4 hover:text-n12">Restaurar</button>
          <button onClick={onClose} aria-label="Fechar" className="grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={16} /></button>
        </div>
      </div>
      {!stems && <p className="text-caption leading-relaxed text-n10">Esta música foi processada sem o servidor local. Abra o Josué pelo atalho (servidor local ligado) e processe a música de novo para separar voz, guitarra, baixo e bateria.</p>}
      {error && <p className="mb-2 text-caption text-amber">Não consegui carregar as faixas. O servidor local está ligado?</p>}
      <ul className="flex flex-col gap-3">
        {list.map((s) => {
          const st = get(s.name)
          return (
            <li key={s.name} className="flex items-center gap-2">
              <button className={chip(st.mute, 'bg-amber text-n1')} aria-pressed={st.mute} title="Mudo" onClick={() => set(s.name, { mute: !st.mute })}>M</button>
              <button className={chip(st.solo, 'bg-gold text-n1')} aria-pressed={st.solo} title="Solo" onClick={() => set(s.name, { solo: !st.solo })}>S</button>
              <span className="w-[92px] shrink-0 truncate text-caption font-medium text-n12">{s.label}</span>
              <input type="range" min={0} max={1} step={0.01} value={st.vol} aria-label={`Volume ${s.label}`} onChange={(e) => set(s.name, { vol: Number(e.target.value) })} className="min-w-0 flex-1 accent-[#e8b437]" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
