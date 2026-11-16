// Afinador de instrumentos de corda: ouve o microfone, mostra a nota tocada e quanto falta
// (em cents) para chegar na corda certa da afinação escolhida. Padrão: violão em Mi.
import { useEffect, useMemo, useRef, useState } from 'react'
import { IClose } from './Icons'
import { INSTRUMENTS, type Instrument, detectPitch, rmsOf, flatName, freqToMidi, midiToFreq, noteName, noteOctave, noteToMidi, ptName } from '../lib/tuner'

/** preset: afinação vinda de uma faixa (ex.: tablatura importada), notas da corda grave para a aguda */
interface Props { onClose: () => void; preset?: { label: string; notes: string[] } }

const IN_TUNE = 5 // cents

/** Corrige erro de oitava: se f×2, f×3 ou f/2 cai bem mais perto de uma corda da afinação, usa esse. */
function fixOctave(f: number, strings: { midi: number }[], locked: number | null): number {
  const targets = locked !== null ? [strings[locked].midi] : strings.map((s) => s.midi)
  const dist = (x: number) => Math.min(...targets.map((m) => Math.abs(freqToMidi(x) - m)))
  const d0 = dist(f)
  if (d0 < 1) return f
  let best = f, bd = d0
  for (const k of [2, 3, 0.5]) {
    const d = dist(f * k)
    if (d < 1 && d < bd) { best = f * k; bd = d }
  }
  return best
}

export default function TunerDialog({ onClose, preset }: Props) {
  // com preset, a 1ª opção é a afinação da faixa (com o nome conhecido, se for uma afinação padrão)
  const instruments = useMemo<Instrument[]>(() => {
    if (!preset?.notes.length) return INSTRUMENTS
    const known = INSTRUMENTS.flatMap((i) => i.tunings).find((t) => t.notes.join() === preset.notes.join())
    const name = known ? known.name : preset.notes.map((n) => n.replace(/d+$/, '')).join(' ')
    return [{ id: 'faixa', name: `Faixa: ${preset.label}`, tunings: [{ id: 'faixa', name, notes: preset.notes }] }, ...INSTRUMENTS]
  }, [preset])
  const [instId, setInstId] = useState(instruments[0].id)
  const inst = instruments.find((i) => i.id === instId) ?? instruments[0]
  const [tuneId, setTuneId] = useState(inst.tunings[0].id)
  const tuning = inst.tunings.find((t) => t.id === tuneId) ?? inst.tunings[0]
  const flats = /bemol|♭|Eb/.test(tuning.name)
  const [locked, setLocked] = useState<number | null>(null) // corda escolhida à mão
  const [freq, setFreq] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'listening' | 'denied' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [sens, setSens] = useState(() => { try { return Number(localStorage.getItem('josue.tuner.sens')) || 8 } catch { return 8 } })
  const sensRef = useRef(sens)
  sensRef.current = sens
  useEffect(() => { try { localStorage.setItem('josue.tuner.sens', String(sens)) } catch { /* sem armazenamento */ } }, [sens])
  const [level, setLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState(() => { try { return localStorage.getItem('josue.tuner.mic') || '' } catch { return '' } })

  const strings = useMemo(() => tuning.notes.map((n) => ({ note: n, midi: noteToMidi(n) })), [tuning])
  const range = useMemo(() => {
    const ms = strings.map((s) => s.midi)
    return { min: midiToFreq(Math.min(...ms)) * 0.6, max: midiToFreq(Math.max(...ms)) * 2.5 }
  }, [strings])
  const rangeRef = useRef(range)
  rangeRef.current = range
  const stringsRef = useRef(strings)
  stringsRef.current = strings
  const lockedRef = useRef(locked)
  lockedRef.current = locked

  // microfone + detecção
  useEffect(() => {
    let stop = false
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null
    let timer = 0
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
        navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput'))).catch(() => {})
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return }
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const an = ctx.createAnalyser()
        an.fftSize = 8192
        src.connect(an)
        const buf = new Float32Array(an.fftSize)
        const hist: number[] = []
        let silentSince = 0
        let peak = 0
        let floor = 1
        setStatus('listening')
        timer = window.setInterval(() => {
          an.getFloatTimeDomainData(buf)
          const r = rmsOf(buf)
          setLevel(Math.max(0, Math.min(1, (20 * Math.log10(r + 1e-9) + 70) / 60)))
          // sensibilidade 1–10: quanto maior, mais baixo o som que o afinador aceita
          const gate = 0.01 * 10 ** (-sensRef.current / 4)
          const sr = ctx!.sampleRate
          const { min, max } = rangeRef.current
          // janela longa (≈170 ms) para as cordas graves; janela curta (≈85 ms) para as agudas,
          // que soam baixo e morrem rápido. Na curta, ignora o que vier abaixo de ~110 Hz.
          const long = detectPitch(buf, sr, min, max, gate)
          const short = max > 300 ? detectPitch(buf.subarray(buf.length - 4096), sr, Math.max(min, 110), max, gate * 0.6) : null
          let f = long
          if (short) {
            const ratio = long ? short / long : 0
            const harmonic = long && ratio > 1.5 && Math.abs(ratio - Math.round(ratio)) < 0.06
            const agree = long && Math.abs(12 * Math.log2(ratio)) < 0.5
            // as duas concordam: fica com a longa (mais precisa); a curta só entra quando a longa falha
            if (!harmonic && !agree) f = short
          }
          if (f) f = fixOctave(f, stringsRef.current, lockedRef.current)
          const now = performance.now()
          // fim do toque: o som já caiu muito em relação ao pico e a medida vira ruído.
          // Congela a última leitura boa em vez de deixar o ponteiro tremer.
          peak = Math.max(peak * 0.97, r)
          floor = Math.min(floor * 1.01, r) // ruído de fundo da sala (sobe devagar, desce na hora)
          const fading = r < peak * 0.25 || r < floor * 3
          if (f && fading) { silentSince = 0; return }
          if (f) {
            silentSince = 0
            // trocou de corda (mais de um semitom): recomeça o histórico para responder na hora
            if (hist.length && Math.abs(12 * Math.log2(f / hist[hist.length - 1])) > 1) hist.length = 0
            hist.push(f)
            if (hist.length > 5) hist.shift()
            const med = [...hist].sort((a, b) => a - b)[Math.floor(hist.length / 2)]
            setFreq(med)
          } else {
            if (!silentSince) silentSince = now
            if (now - silentSince > 2500) { hist.length = 0; setFreq(null) }
          }
        }, 60)
      } catch (e) {
        const name = (e as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied')
        else { setStatus('error'); setErrMsg(String((e as Error)?.message ?? e)) }
      }
    })()
    return () => {
      stop = true
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [deviceId])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  // corda alvo: a escolhida ou a mais próxima da nota tocada
  const midi = freq ? freqToMidi(freq) : null
  let target = locked
  if (target === null && midi !== null) {
    let best = 0
    strings.forEach((s, i) => { if (Math.abs(s.midi - midi) < Math.abs(strings[best].midi - midi)) best = i })
    target = best
  }
  const cents = midi !== null && target !== null ? (midi - strings[target].midi) * 100 : null
  const shown = cents === null ? 0 : Math.max(-50, Math.min(50, cents))
  const ok = cents !== null && Math.abs(cents) <= IN_TUNE
  const far = cents !== null && Math.abs(cents) > 50
  const label = (n: string) => (flats ? flatName(n) : n)

  // tom de referência da corda
  const refCtx = useRef<AudioContext | null>(null)
  const playRef = (m: number) => {
    const ctx = (refCtx.current ??= new AudioContext())
    const t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
    g.connect(ctx.destination)
    for (const [mult, amp] of [[1, 1], [2, 0.45], [3, 0.2]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = midiToFreq(m) * mult
      og.gain.value = amp
      o.connect(og).connect(g)
      o.start(t); o.stop(t + 2.3)
    }
  }
  useEffect(() => () => { void refCtx.current?.close() }, [])

  const color = cents === null ? 'var(--color-n8)' : ok ? '#4ade80' : Math.abs(cents) < 20 ? 'var(--color-gold)' : 'var(--color-amber)'
  const angle = (shown / 50) * 60 // graus

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Afinador" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative flex max-h-[94dvh] w-full max-w-[560px] flex-col overflow-y-auto rounded-r6 border-2 border-gold/60 bg-n1 bg-cover bg-top shadow-[0_10px_60px_#000c,0_0_40px_#e8b43733]" style={{ backgroundImage: 'linear-gradient(180deg, #0b1529cc 0%, #0b1529ee 55%, #0b1529 100%), url(./img/fundo-musica.webp)' }}>
        <div className="flex items-center gap-3 px-5 pt-4">
          <h2 className="josue-title flex-1 text-[30px] leading-tight">Afinador</h2>
          <button onClick={onClose} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-r4 text-n11 hover:bg-n4 hover:text-n12"><IClose size={20} /></button>
        </div>

        <div className="grid gap-2 px-5 pt-3 sm:grid-cols-2">
          <label className="text-caption text-n11">Instrumento
            <select value={instId} onChange={(e) => { const i = instruments.find((x) => x.id === e.target.value)!; setInstId(i.id); setTuneId(i.tunings[0].id); setLocked(null) }}
              className="mt-1 h-10 w-full rounded-r4 border border-n6 bg-n2 px-2 text-sm2 text-n12 outline-none focus:border-gold">
              {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className="text-caption text-n11">Afinação
            <select value={tuning.id} onChange={(e) => { setTuneId(e.target.value); setLocked(null) }}
              className="mt-1 h-10 w-full rounded-r4 border border-n6 bg-n2 px-2 text-sm2 text-n12 outline-none focus:border-gold">
              {inst.tunings.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>

        {/* mostrador */}
        <div className="relative mx-auto mt-4 w-full max-w-[400px] px-5">
          <svg viewBox="-110 -110 220 130" className="w-full" aria-hidden>
            <path d="M -95 0 A 95 95 0 0 1 95 0" fill="none" stroke="var(--color-n5)" strokeWidth="10" strokeLinecap="round" />
            <path d={`M ${-95 * Math.sin(Math.PI / 36)} ${-95 * Math.cos(Math.PI / 36)} A 95 95 0 0 1 ${95 * Math.sin(Math.PI / 36)} ${-95 * Math.cos(Math.PI / 36)}`} fill="none" stroke="#4ade80" strokeWidth="10" />
            {Array.from({ length: 21 }, (_, i) => {
              const a = ((i - 10) / 10) * (Math.PI / 3)
              const r1 = i % 5 === 0 ? 78 : 83
              return <line key={i} x1={r1 * Math.sin(a)} y1={-r1 * Math.cos(a)} x2={88 * Math.sin(a)} y2={-88 * Math.cos(a)} stroke="var(--color-n9)" strokeWidth={i % 5 === 0 ? 2 : 1} />
            })}
            <text x="-70" y="12" fill="var(--color-n10)" fontSize="9" textAnchor="middle">♭ grave</text>
            <text x="70" y="12" fill="var(--color-n10)" fontSize="9" textAnchor="middle">agudo ♯</text>
            <g transform={`rotate(${angle.toFixed(1)})`}>
              <line x1="0" y1="0" x2="0" y2="-90" stroke={color} strokeWidth="3" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
            </g>
            <circle r="7" fill={color} />
          </svg>
          <div className="-mt-1 text-center">
            <p className="text-[64px] font-bold leading-none" style={{ color, textShadow: ok ? '0 0 24px #4ade8088' : undefined }}>
              {midi !== null ? label(noteName(midi)) : '–'}
              {midi !== null && <sub className="ml-1 text-[22px] font-medium text-n10">{noteOctave(midi)}</sub>}
            </p>
            <p className="mt-1 h-6 text-sm2 text-n11">
              {midi !== null ? <>{ptName(noteName(midi))} · {freq!.toFixed(1)} Hz · {cents! > 0 ? '+' : ''}{Math.round(cents!)} cents</> : status === 'listening' ? 'Toque uma corda…' : ''}
            </p>
            <p className="mt-1 h-7 text-body font-semibold" style={{ color }}>
              {cents === null ? '' : ok ? 'Afinado ✓' : far ? 'Longe da corda — confira qual está tocando' : cents < 0 ? 'Muito grave: aperte a tarraxa ↑' : 'Muito agudo: afrouxe a tarraxa ↓'}
            </p>
          </div>
        </div>

        {/* cordas */}
        <div className="px-5 pb-2 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-caption text-n11">Cordas (grave → aguda) {locked === null ? '· detecção automática' : ''}</p>
            {locked !== null && <button onClick={() => setLocked(null)} className="text-caption text-gold hover:underline">Automático</button>}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {strings.map((s, i) => {
              const active = target === i
              return (
                <button key={i} onClick={() => { setLocked(locked === i ? null : i); playRef(s.midi) }} title={`Corda ${strings.length - i}: ${ptName(noteName(s.midi))} — clique para ouvir e fixar`}
                  className={`flex h-14 min-w-[52px] flex-col items-center justify-center rounded-r5 border-2 px-2 transition ${active ? (ok ? 'border-[#4ade80] bg-[#4ade80]/15' : 'border-gold bg-gold/15') : 'border-n6 bg-n2/80 hover:border-n8'} ${locked === i ? 'ring-2 ring-gold/50' : ''}`}>
                  <span className={`text-[19px] font-bold leading-none ${active ? 'text-n12' : 'text-n11'}`}>{label(noteName(s.midi))}</span>
                  <span className="mt-0.5 text-[10px] text-n9">{noteOctave(s.midi)} · {strings.length - i}ª</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* microfone */}
        <div className="grid gap-2 px-5 pt-2 sm:grid-cols-2">
          <label className="text-caption text-n11">Microfone
            <select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); try { localStorage.setItem('josue.tuner.mic', e.target.value) } catch { /* */ } }}
              className="mt-1 h-9 w-full rounded-r4 border border-n6 bg-n2 px-2 text-caption text-n12 outline-none focus:border-gold">
              <option value="">Padrão do sistema</option>
              {devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>)}
            </select>
          </label>
          <label className="text-caption text-n11">Sensibilidade: {sens}
            <input type="range" min={1} max={10} value={sens} onChange={(e) => setSens(Number(e.target.value))} className="mt-3 w-full accent-[#e8b437]" />
          </label>
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2 text-caption text-n11">Nível do som
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-n4"><div className="h-2 rounded-full transition-[width] duration-75" style={{ width: `${level * 100}%`, background: level > 0.15 ? 'var(--color-gold)' : 'var(--color-n8)' }} /></div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-2 text-center text-caption leading-snug text-n10">
          {status === 'idle' && 'Pedindo acesso ao microfone…'}
          {status === 'listening' && 'Toque uma corda por vez, deixando soar. Se a barra de nível quase não se mexe, aumente a sensibilidade ou escolha outro microfone.'}
          {status === 'denied' && <span className="text-amber">O acesso ao microfone foi negado. Libere o microfone para este site nas permissões do navegador e abra o afinador de novo.</span>}
          {status === 'error' && <span className="text-amber">Não foi possível usar o microfone: {errMsg}</span>}
        </div>
      </div>
    </div>
  )
}
