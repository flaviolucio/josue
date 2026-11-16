// Ferramentas de acorde para o músico: outras posições (com condução de vozes), dicionário,
// treino de troca de acordes e treino de ouvido.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChordDiagram } from './ChordDiagram'
import { IClose } from './Icons'
import { chordPitchClasses, noteName, parseChord } from '../lib/chords'
import { chordShape } from '../lib/diagrams'
import { closestVoicing, playChord, voicings } from '../lib/theory'
import { click } from '../lib/rhythm'

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-3" role="dialog" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`flex max-h-[92dvh] w-full ${wide ? 'max-w-[760px]' : 'max-w-[560px]'} flex-col overflow-hidden rounded-r6 border-2 border-gold/60 bg-n1 shadow-2xl shadow-black/60`}>
        <div className="flex items-center justify-between border-b border-n4 px-5 py-3">
          <h2 className="josue-title text-[24px] leading-tight">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

const notesOf = (name: string) => {
  const pc = chordPitchClasses(name)
  const flat = parseChord(name)?.flat ?? false
  return pc ? pc.pcs.map((p) => noteName(p, flat)).join(' · ') : ''
}

function Voicings({ name, prev }: { name: string; prev?: string }) {
  const opts = useMemo(() => voicings(name), [name])
  const best = useMemo(() => closestVoicing(opts, prev ? chordShape(prev, 'violao') : null), [opts, prev])
  if (!opts.length) return <p className="text-sm2 text-n10">Não há desenho de violão para este acorde.</p>
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 [&_svg]:h-auto [&_svg]:w-full">
      {opts.map((s, i) => (
        <div key={i} className="relative">
          <ChordDiagram name={i === 0 ? `${name}` : `${name} · ${s.baseFret}ª`} instrument="violao" shape={s} active={prev ? i === best : i === 0} />
          {prev && i === best && <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-n1">mais perto do {prev}</span>}
        </div>
      ))}
    </div>
  )
}

/** 4. Posições do acorde, com a sugestão de menor movimento a partir do acorde anterior. */
export function VoicingsDialog({ name, prev, onClose }: { name: string; prev?: string; onClose: () => void }) {
  return (
    <Modal title={`Posições de ${name}`} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm2 text-n11">
        <span>Notas: <b className="font-mono text-gold">{notesOf(name)}</b></span>
        <button onClick={() => playChord(name)} className="h-8 rounded-r4 bg-n3 px-3 text-caption font-semibold text-n12 hover:bg-n4">🔊 Ouvir</button>
      </div>
      <Voicings name={name} prev={prev} />
      {prev && <p className="mt-3 text-caption text-n10">A marcada fica na mesma região do braço que o {prev} (o acorde que vem antes na música): a mão anda menos na troca.</p>}
    </Modal>
  )
}

/** 7. Dicionário: qualquer acorde, com notas, posições e som. */
export function ChordDictionary({ onClose, initial = 'C' }: { onClose: () => void; initial?: string }) {
  const [q, setQ] = useState(initial)
  const name = q.trim().replace(/^([a-g])/, (m) => m.toUpperCase())
  const ok = !!parseChord(name) && !!chordPitchClasses(name)
  const examples = ['C', 'Am7', 'G7M', 'F#m7(b5)', 'Dsus4', 'E5', 'Bb7', 'Gm(7M)', 'C/E', 'A7(9)']
  return (
    <Modal title="Dicionário de acordes" onClose={onClose} wide>
      <div className="flex gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite um acorde: Am7, F#m7(b5), D/F#…"
          className="h-11 min-w-0 flex-1 rounded-r4 border border-n6 bg-n2 px-3 font-mono text-body text-n12 outline-none focus:border-gold" />
        <button onClick={() => ok && playChord(name)} disabled={!ok} className="h-11 rounded-r4 bg-gold px-4 text-sm2 font-semibold text-n1 disabled:opacity-40">🔊 Ouvir</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.map((e) => <button key={e} onClick={() => setQ(e)} className="rounded-r3 bg-n3 px-2 py-0.5 font-mono text-caption text-n11 hover:text-gold">{e}</button>)}
      </div>
      {ok ? (
        <div className="mt-4">
          <p className="mb-3 text-sm2 text-n11">Notas de <b className="font-mono text-n12">{name}</b>: <b className="font-mono text-gold">{notesOf(name)}</b></p>
          <Voicings name={name} />
          <div className="mt-4 rounded-r4 border border-n4 bg-n2 p-3">
            <p className="mb-1 text-caption text-n10">Teclado</p>
            <ChordDiagram name={name} instrument="teclado" />
          </div>
        </div>
      ) : <p className="mt-6 text-center text-sm2 text-n10">{q.trim() ? 'Acorde não reconhecido. Ex.: C, Am7, G7M, F#m7(b5), D/F#' : 'Digite um acorde.'}</p>}
    </Modal>
  )
}

/** 2. Treino de troca: alterna dois acordes com metrônomo, acelerando aos poucos. */
export function ChangeTrainer({ pairs, onClose }: { pairs: { a: string; b: string; times: number }[]; onClose: () => void }) {
  const [pi, setPi] = useState(0)
  const [bpm, setBpm] = useState(60)
  const [beatsPer, setBeatsPer] = useState(4)
  const [auto, setAuto] = useState(true)
  const [run, setRun] = useState(false)
  const [beat, setBeat] = useState(0)
  const st = useRef({ n: 0 })
  const p = pairs[pi]
  useEffect(() => {
    if (!run) return
    st.current.n = 0
    const id = window.setInterval(() => {
      const n = st.current.n++
      click(n % beatsPer === 0)
      setBeat(n)
      // a cada 8 trocas certinhas, +5 BPM
      if (auto && n > 0 && n % (beatsPer * 8) === 0) setBpm((v) => Math.min(200, v + 5))
    }, 60000 / bpm)
    return () => clearInterval(id)
  }, [run, bpm, beatsPer, auto])
  if (!p) return <Modal title="Treino de troca" onClose={onClose}><p className="text-sm2 text-n10">Esta música não tem trocas de acorde suficientes.</p></Modal>
  const current = Math.floor(beat / beatsPer) % 2 === 0 ? p.a : p.b
  const inBar = beat % beatsPer
  return (
    <Modal title="Treino de troca" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {pairs.map((x, i) => (
          <button key={i} onClick={() => { setPi(i); setRun(false) }} className={`rounded-r4 px-3 py-1 font-mono text-sm2 ${i === pi ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}>{x.a} ⇄ {x.b} <span className="font-sans text-caption opacity-70">({x.times}×)</span></button>
        ))}
      </div>
      <p className="mb-3 text-caption text-n10">As trocas mais difíceis desta música. Toque {beatsPer} tempos em cada acorde, sem parar. A cada 8 trocas o metrônomo acelera 5 BPM.</p>
      <div className="grid grid-cols-2 gap-3 [&_figcaption]:text-[24px] [&_svg]:h-auto [&_svg]:w-full">
        {[p.a, p.b].map((c) => (
          <div key={c} className={`rounded-r5 p-1 transition ${run && c === current ? 'ring-4 ring-gold' : ''}`}><ChordDiagram name={c} instrument="violao" active={run && c === current} /></div>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-2">{Array.from({ length: beatsPer }, (_, i) => <span key={i} className={`h-3 w-3 rounded-full ${run && i === inBar ? (i === 0 ? 'bg-gold' : 'bg-n12') : 'bg-n5'}`} />)}</div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button onClick={() => setRun((v) => !v)} className="gold-btn h-11 rounded-r5 px-6 text-sm2 font-bold text-n1">{run ? '■ Parar' : '▶ Começar'}</button>
        <label className="flex items-center gap-2 text-caption text-n11">BPM
          <input type="range" min={40} max={200} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="accent-[#e8b437]" />
          <b className="w-8 font-mono text-n12">{bpm}</b>
        </label>
        <select value={beatsPer} onChange={(e) => setBeatsPer(Number(e.target.value))} className="h-9 rounded-r4 border border-n5 bg-n2 px-2 text-caption text-n12">
          {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'tempo' : 'tempos'} por acorde</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-caption text-n11"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[#e8b437]" /> acelerar sozinho</label>
      </div>
    </Modal>
  )
}

/** 11. Treino de ouvido: o Josué toca um acorde da música e você diz qual é. */
export function EarTraining({ chords, onClose }: { chords: string[]; onClose: () => void }) {
  const pool = useMemo(() => [...new Set(chords)].filter((c) => chordPitchClasses(c)).slice(0, 12), [chords])
  const [answer, setAnswer] = useState('')
  const [picked, setPicked] = useState('')
  const [score, setScore] = useState({ ok: 0, total: 0 })
  const next = () => {
    const a = pool[Math.floor(Math.random() * pool.length)]
    setAnswer(a); setPicked('')
    setTimeout(() => playChord(a, false), 150)
  }
  useEffect(() => { if (pool.length >= 2) next() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (pool.length < 2) return <Modal title="Treino de ouvido" onClose={onClose}><p className="text-sm2 text-n10">Esta música precisa ter pelo menos 2 acordes diferentes.</p></Modal>
  const choose = (c: string) => {
    if (picked) return
    setPicked(c)
    setScore((s) => ({ ok: s.ok + (c === answer ? 1 : 0), total: s.total + 1 }))
  }
  return (
    <Modal title="Treino de ouvido" onClose={onClose}>
      <p className="text-sm2 text-n11">Ouça o acorde e escolha qual é. São os acordes desta música.</p>
      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => playChord(answer, false)} className="h-10 rounded-r4 bg-n3 px-4 text-sm2 font-semibold text-n12 hover:bg-n4">🔊 Ouvir de novo</button>
        <button onClick={() => playChord(answer, true)} className="h-10 rounded-r4 bg-n3 px-4 text-sm2 font-semibold text-n12 hover:bg-n4">🎸 Ouvir dedilhado</button>
        <span className="text-sm2 text-n11">Acertos: <b className="text-gold">{score.ok}/{score.total}</b></span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {pool.map((c) => {
          const right = picked && c === answer, wrong = picked === c && c !== answer
          return <button key={c} onClick={() => choose(c)} className={`h-12 rounded-r4 font-mono text-[18px] font-bold transition ${right ? 'bg-[#1f9d5c] text-white' : wrong ? 'bg-error text-white' : 'bg-n2 text-n12 hover:bg-n3'} border border-n5`}>{c}</button>
        })}
      </div>
      {picked && (
        <div className="mt-4 flex items-center justify-between">
          <p className={`text-sm2 font-semibold ${picked === answer ? 'text-[#3ee08f]' : 'text-amber'}`}>{picked === answer ? 'Acertou! 🎉' : `Era ${answer}.`}</p>
          <button onClick={next} className="gold-btn h-10 rounded-r5 px-5 text-sm2 font-bold text-n1">Próximo ▶</button>
        </div>
      )}
    </Modal>
  )
}
