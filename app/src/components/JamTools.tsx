// Para o músico: tocar junto com a "banda virtual" e se gravar (4) e comparar a cifra em dois tons (5).
import { useEffect, useMemo, useRef, useState } from 'react'
import { IClose } from './Icons'
import { visibleStems, type MixState } from './Mixer'
import { buildCifra, cifraToRows } from '../lib/cifra'
import { preferFlats, transposeChord, transposeKey, transposeOptions } from '../lib/chords'
import type { ChordEvent, Section, Stems, Word } from '../lib/types'
import { formatTime } from '../lib/audio'

// ---------------- 4. tocar junto e gravar ----------------
export function JamPanel({ audio, stems, mix, setMix, onClose }: { audio: HTMLAudioElement; stems?: Stems; mix: MixState; setMix: (m: MixState) => void; onClose: () => void }) {
  const names = visibleStems(stems).map((s) => s.name)
  const band: string[] = names.filter((n) => n === 'drums' || n === 'bass')
  const bandOn = band.length > 0 && names.every((n) => (band.includes(n) ? !mix[n]?.mute : !!mix[n]?.mute))
  const setBand = (on: boolean) => {
    if (!on) { setMix({}); return }
    const m: MixState = {}
    for (const n of names) m[n] = { vol: 1, solo: false, mute: !band.includes(n) }
    setMix(m)
  }
  const [rec, setRec] = useState<'idle' | 'rec' | 'done'>('idle')
  const [take, setTake] = useState<{ url: string; start: number; dur: number } | null>(null)
  const [delay, setDelay] = useState(() => { try { return Number(localStorage.getItem('josue.jamDelay')) || 120 } catch { return 120 } })
  const [err, setErr] = useState('')
  const [playingBack, setPlayingBack] = useState(false)
  const mr = useRef<MediaRecorder | null>(null)
  const startAt = useRef(0)
  const takeAudio = useMemo(() => new Audio(), [])
  useEffect(() => () => { mr.current?.stream.getTracks().forEach((t) => t.stop()); takeAudio.pause(); if (take) URL.revokeObjectURL(take.url) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('josue.jamDelay', String(delay)) } catch { /* */ } }, [delay])

  const start = async () => {
    setErr('')
    try {
      let mic = ''
      try { mic = localStorage.getItem('josue.tuner.mic') || '' } catch { /* */ }
      const c = { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
      let stream: MediaStream
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { ...c, deviceId: { exact: mic } } : c }) } catch { stream = await navigator.mediaDevices.getUserMedia({ audio: c }) }
      const chunks: Blob[] = []
      const r = new MediaRecorder(stream)
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' })
        if (take) URL.revokeObjectURL(take.url)
        setTake({ url: URL.createObjectURL(blob), start: startAt.current, dur: audio.currentTime - startAt.current })
        setRec('done')
      }
      mr.current = r
      startAt.current = audio.currentTime
      r.start()
      void audio.play()
      setRec('rec')
    } catch (e) { setErr((e as DOMException)?.name === 'NotAllowedError' ? 'Microfone bloqueado. Libere nas permissões do navegador.' : String((e as Error).message)) }
  }
  const stop = () => { audio.pause(); mr.current?.stop() }
  const listen = () => {
    if (!take) return
    takeAudio.src = take.url
    audio.currentTime = take.start
    takeAudio.currentTime = Math.max(0, delay / 1000) // compensa o atraso do microfone
    void audio.play(); void takeAudio.play()
    setPlayingBack(true)
    const end = () => { audio.pause(); setPlayingBack(false) }
    takeAudio.onended = end
  }
  const stopListen = () => { takeAudio.pause(); audio.pause(); setPlayingBack(false) }

  return (
    <div className="splash-in fixed bottom-[118px] right-3 z-40 w-[320px] rounded-[18px] border-2 border-gold/70 bg-n1/95 p-3 shadow-[0_12px_50px_#000c] backdrop-blur-md md:right-6" role="dialog" aria-label="Tocar junto e gravar">
      <div className="flex items-center justify-between">
        <p className="text-caption font-semibold uppercase tracking-wider text-n11">Tocar junto e gravar</p>
        <button onClick={onClose} aria-label="Fechar" className="grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={16} /></button>
      </div>
      <div className="mt-2 rounded-r4 bg-n2 p-2">
        <p className="text-caption text-n11">Banda virtual</p>
        {band.length ? (
          <div className="mt-1 flex gap-1">
            <button onClick={() => setBand(true)} className={`h-8 flex-1 rounded-r3 text-caption font-semibold ${bandOn ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}>Só bateria + baixo</button>
            <button onClick={() => setBand(false)} className={`h-8 flex-1 rounded-r3 text-caption font-semibold ${!bandOn ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}>Música inteira</button>
          </div>
        ) : <p className="mt-1 text-[11px] text-n9">Esta música não tem faixas separadas; você grava por cima da música inteira. (Processe com o servidor ligado para ter bateria e baixo separados.)</p>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {rec !== 'rec'
          ? <button onClick={() => void start()} className="h-10 flex-1 rounded-r4 bg-error font-semibold text-white hover:brightness-110">● Gravar daqui</button>
          : <button onClick={stop} className="pulse-soft h-10 flex-1 rounded-r4 bg-error font-semibold text-white">■ Parar ({formatTime(Math.max(0, audio.currentTime - startAt.current))})</button>}
      </div>
      {take && rec === 'done' && (
        <div className="mt-2 rounded-r4 border border-n4 p-2">
          <p className="text-caption text-n11">Gravação de {formatTime(take.start)} a {formatTime(take.start + take.dur)}</p>
          <div className="mt-1.5 flex gap-1">
            {!playingBack
              ? <button onClick={listen} className="h-8 flex-1 rounded-r3 bg-gold text-caption font-semibold text-n1">▶ Ouvir com a banda</button>
              : <button onClick={stopListen} className="h-8 flex-1 rounded-r3 bg-n3 text-caption font-semibold text-n12">■ Parar</button>}
            <a href={take.url} download={`minha-gravacao.${take.url ? 'webm' : 'webm'}`} className="grid h-8 place-items-center rounded-r3 bg-n3 px-3 text-caption font-semibold text-n12 hover:bg-n4">Baixar</a>
          </div>
          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-n10" title="Se a sua gravação parecer atrasada em relação à banda, aumente">Ajuste de atraso
            <input type="range" min={0} max={400} step={10} value={delay} onChange={(e) => setDelay(Number(e.target.value))} className="flex-1 accent-[#e8b437]" /> <b className="w-12 text-n12">{delay} ms</b>
          </label>
        </div>
      )}
      {err && <p className="mt-2 text-caption text-amber">{err}</p>}
      <p className="mt-2 text-[11px] leading-snug text-n9">Use fones de ouvido para a banda não vazar na gravação.</p>
    </div>
  )
}

// ---------------- 5. comparar dois tons ----------------
export function CompareKeys({ words, chords, sections, songKey, initialA, onClose }: { words: Word[]; chords: ChordEvent[]; sections: Section[]; songKey: string; initialA: number; onClose: () => void }) {
  const [a, setA] = useState(initialA)
  const [b, setB] = useState(initialA === 0 ? 2 : 0)
  const opts = songKey ? transposeOptions(songKey) : Array.from({ length: 13 }, (_, i) => ({ semis: i - 6, label: `${i - 6 > 0 ? '+' : ''}${i - 6}` }))
  const rowsFor = (s: number) => {
    const flats = preferFlats(songKey ? transposeKey(songKey, s) : '')
    return cifraToRows(buildCifra(words, chords, sections, (c) => transposeChord(c, s, flats)), { chords: true, lyrics: true, sections: true })
  }
  const ra = useMemo(() => rowsFor(a), [a]) // eslint-disable-line react-hooks/exhaustive-deps
  const rb = useMemo(() => rowsFor(b), [b]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const sel = (v: number, set: (n: number) => void) => (
    <select value={v} onChange={(e) => set(Number(e.target.value))} className="h-9 rounded-r4 border border-gold/60 bg-n2 px-2 text-sm2 text-n12">
      {opts.map((o) => <option key={o.semis} value={o.semis}>{o.label}</option>)}
    </select>
  )
  const cell = (r: { kind: string; text: string } | undefined) => !r ? null
    : r.kind === 'section' ? <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-gold">{r.text.replace(/[[\]]/g, '')}</span>
    : <span className={r.kind === 'chord' ? 'font-bold text-gold' : r.kind === 'note' ? 'italic text-amber' : 'text-n11'}>{r.text || ' '}</span>
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-3" role="dialog" aria-label="Comparar tons" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-r6 border-2 border-gold/60 bg-n1 shadow-2xl shadow-black/60">
        <div className="flex flex-wrap items-center gap-3 border-b border-n4 px-5 py-3">
          <h2 className="josue-title text-[24px] leading-tight">Comparar tons</h2>
          <span className="text-caption text-n10">Lado a lado, linha por linha.</span>
          <button onClick={onClose} aria-label="Fechar" className="ml-auto grid h-8 w-8 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b border-n4 px-5 py-2">
          <label className="flex items-center gap-2 text-caption text-n11">Tom A {sel(a, setA)}</label>
          <label className="flex items-center gap-2 text-caption text-n11">Tom B {sel(b, setB)}</label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3 font-mono text-[14px] leading-[1.45]">
          <table className="w-full border-separate border-spacing-x-4"><tbody>
            {ra.map((r, i) => r.kind === 'blank' ? <tr key={i}><td className="h-3" /><td /></tr> : (
              <tr key={i}><td className="w-1/2 whitespace-pre align-top">{cell(r)}</td><td className="w-1/2 whitespace-pre border-l border-n4 pl-4 align-top">{cell(rb[i])}</td></tr>
            ))}
          </tbody></table>
        </div>
      </div>
    </div>
  )
}
