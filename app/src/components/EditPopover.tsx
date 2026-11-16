import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QUALITY_SUGGESTIONS, SHARPS, FLATS, parseChord } from '../lib/chords'
import { SECTION_LABELS } from '../lib/types'

export type EditTarget =
  | { kind: 'chord'; index: number; name: string; rect: DOMRect }
  | { kind: 'syllable'; wordIndex: number; offset: number; word: string; rect: DOMRect }
  | { kind: 'section'; index: number; label: string; rect: DOMRect }

interface Props {
  target: EditTarget
  flats: boolean
  onClose: () => void
  onRenameChord: (index: number, name: string) => void
  onRemoveChord: (index: number) => void
  onAddChord: (wordIndex: number, offset: number, name: string) => void
  onEditWord: (wordIndex: number, text: string) => void
  onRenameSection: (index: number, label: string) => void
  onSplitSection: (wordIndex: number) => void
  onMergeSection: (index: number) => void
}

export default function EditPopover(p: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = p.target.rect
    const w = el.offsetWidth, h = el.offsetHeight
    let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))
    let top = r.bottom + 8
    if (top + h > window.innerHeight - 120) top = Math.max(8, r.top - h - 8)
    left = Math.max(8, left)
    setPos({ left, top })
  }, [p.target])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) p.onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [p])

  return (
    <div ref={ref} role="dialog" aria-label="Editar" className="fixed z-50 w-[300px] rounded-r5 border border-n5 bg-n3 p-3 font-sans shadow-2xl shadow-black/60" style={pos}>
      {p.target.kind === 'chord' && <ChordEditor {...p} target={p.target} />}
      {p.target.kind === 'syllable' && <SyllableEditor {...p} target={p.target} />}
      {p.target.kind === 'section' && <SectionEditor {...p} target={p.target} />}
    </div>
  )
}

function ChordPicker({ value, setValue, flats }: { value: string; setValue: (v: string) => void; flats: boolean }) {
  const parsed = parseChord(value)
  const roots = flats ? FLATS : SHARPS
  const rootName = parsed ? roots[parsed.root] : 'C'
  const quality = parsed?.quality ?? ''
  const bass = value.includes('/') ? value.slice(value.indexOf('/')) : ''
  return (
    <>
      <div className="mt-2 grid grid-cols-6 gap-1">
        {roots.map((r) => (
          <button key={r} onClick={() => setValue(r + quality + bass)} className={`h-7 rounded-r3 font-mono text-[12px] font-semibold ${r === rootName ? 'bg-gold text-n1' : 'bg-n4 text-n12 hover:bg-n5'}`}>{r}</button>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {QUALITY_SUGGESTIONS.map((q) => (
          <button key={q || 'maj'} onClick={() => setValue(rootName + q + bass)} className={`h-7 rounded-r3 px-2 font-mono text-[12px] ${q === quality ? 'bg-gold/20 text-gold' : 'bg-n4 text-n11 hover:bg-n5'}`}>{q || 'maior'}</button>
        ))}
      </div>
    </>
  )
}

function ChordEditor(p: Props & { target: Extract<EditTarget, { kind: 'chord' }> }) {
  const [v, setV] = useState(p.target.name)
  const valid = !!parseChord(v)
  const save = () => { if (valid) { p.onRenameChord(p.target.index, v.trim()); p.onClose() } }
  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wide text-n10">Trocar acorde</p>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className={`mt-2 h-9 w-full rounded-r4 border bg-n1 px-3 font-mono text-[15px] text-n12 outline-none ${valid ? 'border-n5 focus:border-gold/70' : 'border-error/70'}`} />
      <ChordPicker value={v} setValue={setV} flats={p.flats} />
      <div className="mt-3 flex justify-between gap-2">
        <button onClick={() => { p.onRemoveChord(p.target.index); p.onClose() }} className="h-8 rounded-r4 px-3 text-caption font-semibold text-error hover:bg-error/10">Remover</button>
        <div className="flex gap-2">
          <button onClick={p.onClose} className="h-8 rounded-r4 px-3 text-caption text-n11 hover:bg-n4">Cancelar</button>
          <button onClick={save} disabled={!valid} className="h-8 rounded-r4 bg-gold px-3 text-caption font-semibold text-n1 disabled:opacity-40">Salvar</button>
        </div>
      </div>
    </div>
  )
}

function SyllableEditor(p: Props & { target: Extract<EditTarget, { kind: 'syllable' }> }) {
  const [word, setWord] = useState(p.target.word)
  const [chord, setChord] = useState('')
  const valid = !!parseChord(chord)
  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wide text-n10">Corrigir palavra</p>
      <div className="mt-2 flex gap-2">
        <input autoFocus value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { p.onEditWord(p.target.wordIndex, word); p.onClose() } }} className="h-9 min-w-0 flex-1 rounded-r4 border border-n5 bg-n1 px-3 font-mono text-[14px] text-n12 outline-none focus:border-gold/70" />
        <button onClick={() => { p.onEditWord(p.target.wordIndex, word); p.onClose() }} className="h-9 rounded-r4 bg-n5 px-3 text-caption font-semibold text-n12 hover:bg-n6">Salvar</button>
      </div>
      <p className="mt-1 text-[11px] text-n9">Deixe vazio para apagar a palavra.</p>
      <p className="mt-3 text-caption font-semibold uppercase tracking-wide text-n10">Acorde nesta sílaba “{p.target.word.slice(p.target.offset)}”</p>
      <input value={chord} onChange={(e) => setChord(e.target.value)} placeholder="ex.: Am7" onKeyDown={(e) => { if (e.key === 'Enter' && valid) { p.onAddChord(p.target.wordIndex, p.target.offset, chord.trim()); p.onClose() } }} className="mt-2 h-9 w-full rounded-r4 border border-n5 bg-n1 px-3 font-mono text-[14px] text-n12 outline-none focus:border-gold/70" />
      <ChordPicker value={chord || 'C'} setValue={setChord} flats={p.flats} />
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => { p.onSplitSection(p.target.wordIndex); p.onClose() }} className="mr-auto h-8 rounded-r4 px-2 text-caption text-n11 hover:bg-n4" title="Começar uma nova seção nesta palavra">+ Nova seção aqui</button>
        <button onClick={p.onClose} className="h-8 rounded-r4 px-3 text-caption text-n11 hover:bg-n4">Fechar</button>
        <button disabled={!valid} onClick={() => { p.onAddChord(p.target.wordIndex, p.target.offset, chord.trim()); p.onClose() }} className="h-8 rounded-r4 bg-gold px-3 text-caption font-semibold text-n1 disabled:opacity-40">Adicionar acorde</button>
      </div>
    </div>
  )
}

function SectionEditor(p: Props & { target: Extract<EditTarget, { kind: 'section' }> }) {
  const [v, setV] = useState(p.target.label)
  const save = () => { if (v.trim()) { p.onRenameSection(p.target.index, v.trim()); p.onClose() } }
  return (
    <div>
      <p className="text-caption font-semibold uppercase tracking-wide text-n10">Renomear seção</p>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} className="mt-2 h-9 w-full rounded-r4 border border-n5 bg-n1 px-3 text-[14px] text-n12 outline-none focus:border-gold/70" />
      <div className="mt-2 flex flex-wrap gap-1">
        {SECTION_LABELS.map((l) => <button key={l} onClick={() => setV(l)} className={`h-7 rounded-full px-2.5 text-[12px] ${l === v ? 'bg-gold/20 text-gold' : 'bg-n4 text-n11 hover:bg-n5'}`}>{l}</button>)}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {p.target.index > 0 && <button onClick={() => { p.onMergeSection(p.target.index); p.onClose() }} className="mr-auto h-8 rounded-r4 px-2 text-caption text-n11 hover:bg-n4">Juntar com a anterior</button>}
        <button onClick={p.onClose} className="h-8 rounded-r4 px-3 text-caption text-n11 hover:bg-n4">Cancelar</button>
        <button onClick={save} className="h-8 rounded-r4 bg-gold px-3 text-caption font-semibold text-n1">Salvar</button>
      </div>
    </div>
  )
}
