import { Fragment, memo, useState } from 'react'

/** chave das anotações: o início da linha (com 1 casa decimal, para tolerar pequenas diferenças) */
export const noteKey = (t0: number) => t0.toFixed(1)
import { syllableStarts, type CifraBlock, type LineWord, type PlacedChord } from '../lib/cifra'
import { formatTime } from '../lib/audio'

export interface Layers { lyrics: boolean; chords: boolean; sections: boolean }

interface Props {
  blocks: CifraBlock[]
  activeLine: number
  activeChord: number
  layers: Layers
  editMode: boolean
  fontSize: number
  onSeek: (t: number) => void
  onChordClick: (index: number, el: HTMLElement) => void
  onSyllableClick: (wordIndex: number, offset: number, el: HTMLElement) => void
  onSectionClick: (section: number, el: HTMLElement) => void
  onMoveChord: (chordIndex: number, wordIndex: number, offset: number) => void
  /** acordes marcados pela revisão guiada (índice → motivo) */
  flags?: Map<number, string>
  /** acordes que acabaram de mudar (piscam por alguns segundos) */
  changed?: Set<number>
  /** "tocou certo?": acordes acertados/errados */
  marks?: Map<number, 'ok' | 'bad'>
  /** anotações do músico por linha (chave: início da linha) */
  notes?: Map<string, string>
  onNote?: (lineT0: number) => void
}

const SECTION_COLORS: Record<string, string> = {
  Intro: '#c4b48f', Verso: '#e8b437', 'Pré-refrão': '#ffe08a', Refrão: '#6fb6ff', Ponte: '#ff9a4d', Solo: '#ff8dcc', Instrumental: '#b4a6ff', Final: '#c4b48f',
}

function CifraViewImpl(p: Props) {
  let lineNo = -1
  return (
    <div className="font-mono" style={{ fontSize: p.fontSize }}>
      {p.blocks.map((b, bi) => (
        <section key={bi} className="mb-7" aria-label={b.label || undefined}>
          {p.layers.sections && b.label && (
            <button
              data-section={b.section}
              onClick={(e) => (p.editMode ? p.onSectionClick(b.section, e.currentTarget) : p.onSeek(b.t0))}
              className="mb-3 inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 font-sans text-[12px] font-semibold uppercase tracking-[0.06em] transition hover:bg-white/5"
              style={{ color: SECTION_COLORS[b.label.split(/\s+(?:\d|·)/)[0]] ?? '#c4b48f', borderColor: (SECTION_COLORS[b.label.split(/\s+(?:\d|·)/)[0]] ?? '#c4b48f') + '55' }}
              title={p.editMode ? 'Renomear seção' : `Ir para ${b.label}`}
            >
              {b.label}
              <span className="font-mono font-normal normal-case tracking-normal text-n9">{formatTime(b.t0)}</span>
              {p.editMode && <span className="text-n9">✎</span>}
            </button>
          )}
          {b.lines.map((line, li) => {
            lineNo++
            const n = lineNo
            const note = p.notes?.get(noteKey(line.t0))
            const noteRow = (note || p.editMode) ? (
              <div key={'n' + li} className="-mx-3 flex items-center gap-2 px-3 pt-1 font-sans text-[0.72em]">
                {note && <span className="rounded-r3 bg-amber/10 px-1.5 italic text-amber">✎ {note}</span>}
                {p.editMode && p.onNote && <button onClick={() => p.onNote!(line.t0)} className="text-[0.9em] text-n9 hover:text-gold">{note ? 'editar nota' : '+ nota'}</button>}
              </div>
            ) : null
            const active = n === p.activeLine
            const past = n < p.activeLine
            const tone = active ? 'text-n12' : past ? 'text-n8' : 'text-n9'
            if (line.kind === 'chords' || !p.layers.lyrics) {
              const chords = line.kind === 'chords' ? line.chords : line.words.flatMap((w) => w.chords)
              if (!p.layers.chords || !chords.length) return noteRow
              return (
                <Fragment key={li}>{noteRow}<div data-line={n} onClick={() => !p.editMode && p.onSeek(line.t0)}
                  className={`group -mx-3 flex cursor-pointer flex-wrap gap-x-[2ch] gap-y-1 rounded-r4 px-3 py-1 transition ${active ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'}`}>
                  {chords.map((c) => <ChordTag key={c.index} c={c} {...p} lineActive={active} />)}
                </div></Fragment>
              )
            }
            const hasChords = p.layers.chords && line.words.some((w) => w.chords.length)
            return (
              <Fragment key={li}>{noteRow}<div data-line={n} onClick={() => !p.editMode && p.onSeek(line.t0)}
                className={`-mx-3 flex cursor-pointer flex-wrap items-end gap-x-[1ch] rounded-r4 px-3 py-1 leading-[1.35] transition-colors duration-200 ${tone} ${active ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03] hover:text-n11'}`}>
                {line.words.map((w) => <WordView key={w.index} w={w} showChords={hasChords} {...p} lineActive={active} />)}
              </div></Fragment>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function ChordTag({ c, activeChord, editMode, onChordClick, onSeek, lineActive, flags, marks, changed }: Props & { c: PlacedChord; lineActive: boolean }) {
  const on = c.index === activeChord
  const flag = flags?.get(c.index)
  const mark = marks?.get(c.index)
  return (
    <button
      draggable={editMode}
      onDragStart={(e) => { e.dataTransfer.setData('text/x-chord', String(c.index)); e.dataTransfer.effectAllowed = 'move' }}
      onClick={(e) => { e.stopPropagation(); if (editMode) onChordClick(c.index, e.currentTarget); else onSeek(c.t0) }}
      className={`whitespace-nowrap rounded-r2 px-0.5 font-semibold leading-tight transition ${on ? 'bg-gold/20 text-gold-100' : lineActive ? 'text-gold' : 'text-gold/70 hover:text-gold'} ${editMode ? 'cursor-grab outline-1 outline-dashed outline-gold/40 active:cursor-grabbing' : ''} ${flag ? '!text-amber bg-amber/15 outline-2 outline-dashed outline-amber' : ''} ${mark === 'ok' ? '!text-[#3ee08f] bg-[#1f9d5c]/20' : mark === 'bad' ? '!text-error bg-error/15' : ''} ${changed?.has(c.index) ? 'chord-flash !text-gold-100' : ''}`}
      data-flag={flag ? c.index : undefined}
      title={flag ? 'Revisar: ' + flag : editMode ? 'Clique para trocar, arraste para mover' : 'Ir para este acorde'}
    >{c.name}</button>
  )
}

function WordView(p: Props & { w: LineWord; showChords: boolean; lineActive: boolean }) {
  const { w } = p
  // pontos de corte: começos de sílaba + posições dos acordes
  const cuts = new Set<number>([0, ...w.chords.map((c) => c.offset)])
  if (p.editMode) syllableStarts(w.text).forEach((s) => cuts.add(s))
  const pts = [...cuts].filter((x) => x < Math.max(1, w.text.length)).sort((a, b) => a - b)
  return (
    <span className="inline-flex items-end whitespace-pre">
      {pts.map((start, i) => {
        const end = pts[i + 1] ?? w.text.length
        const chords = w.chords.filter((c) => c.offset === start)
        return <Syllable key={start} {...p} start={start} text={w.text.slice(start, end)} chords={chords} />
      })}
    </span>
  )
}

function Syllable(p: Props & { w: LineWord; start: number; text: string; chords: PlacedChord[]; showChords: boolean; lineActive: boolean }) {
  const [over, setOver] = useState(false)
  const width = p.showChords && p.chords.length ? p.chords.reduce((a, c) => a + c.name.length + 1, 0) : 0
  return (
    <span
      className={`inline-flex flex-col ${over ? 'rounded-r2 bg-gold/20' : ''}`}
      style={width ? { minWidth: `${width}ch` } : undefined}
      onDragOver={p.editMode ? (e) => { if (e.dataTransfer.types.includes('text/x-chord')) { e.preventDefault(); setOver(true) } } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={p.editMode ? (e) => { e.preventDefault(); setOver(false); const ci = Number(e.dataTransfer.getData('text/x-chord')); if (!Number.isNaN(ci)) p.onMoveChord(ci, p.w.index, p.start) } : undefined}
    >
      {p.showChords && (
        <span className="flex h-[1.4em] items-end gap-[1ch]">
          {p.chords.map((c) => <ChordTag key={c.index} {...p} c={c} />)}
        </span>
      )}
      <span
        onClick={p.editMode ? (e) => { e.stopPropagation(); p.onSyllableClick(p.w.index, p.start, e.currentTarget) } : undefined}
        className={p.editMode ? 'cursor-text rounded-r1 hover:bg-white/10' : ''}
      >{p.text}</span>
    </span>
  )
}

export default memo(CifraViewImpl)
