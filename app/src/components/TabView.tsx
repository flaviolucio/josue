// Aba "Tablatura": partitura + tablatura estilo Guitar Pro (alphaTab), sincronizada com o
// player da página (o <audio> da página é o relógio, modo "mídia externa" do alphaTab).
// Também é o editor: clique numa nota (ou num tempo vazio) e edite pelo teclado ou pela barra.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as alphaTab from '@coderline/alphatab'
import { TimeMap, trackToMusicXml, trackToTex, type BeatSlots, type TabView as Variant } from '../lib/alphatex'
import type { ChordEvent, TabNote, Tabs } from '../lib/types'
import { TabSynth } from '../lib/pluck'
import { exportTabPdf } from '../lib/tabPdf'

export type TabSound = 'original' | 'notes' | 'both'

interface Props {
  tabs?: Tabs
  audio: HTMLAudioElement
  title: string
  timeSig: string
  duration: number
  onChange?: (tabs: Tabs) => void
  /** acordes da música (já com o nome como deve aparecer) */
  chords?: ChordEvent[]
  sound?: TabSound
  setSound?: (s: TabSound) => void
  /** trechos sem voz (intro, solos, instrumentais) */
  parts?: { label: string; t0: number; t1: number }[]
}

interface Option { key: string; track: number; view: Variant; label: string; count: number }
interface Sel { slot: number; string: number }
interface Box { x: number; y: number; w: number; h: number }

const MAX_FRET = 24
const DURS: { slots: number; label: string; title: string }[] = [
  { slots: 1, label: '𝅘𝅥𝅯', title: 'Semicolcheia (1/16)' },
  { slots: 2, label: '♪', title: 'Colcheia (1/8)' },
  { slots: 4, label: '♩', title: 'Semínima (1/4)' },
  { slots: 8, label: '𝅗𝅥', title: 'Mínima (1/2)' },
  { slots: 16, label: '𝅝', title: 'Semibreve (1)' },
]

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim() || 'tablatura'

export default function TabView({ tabs, audio, title, timeSig, duration, onChange, chords, sound = 'original', setSound, parts }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const beatsRef = useRef<BeatSlots>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [renderTick, setRenderTick] = useState(0)
  const [scale, setScale] = useState(() => (window.innerWidth < 640 ? 0.7 : 0.95))
  const [staff, setStaff] = useState<'tabs' | 'both'>('tabs')
  const [exportOpen, setExportOpen] = useState(false)

  // cópia local editável (as edições são salvas pelo onChange)
  const [data, setData] = useState<Tabs | undefined>(tabs)
  const past = useRef<Tabs[]>([])
  const future = useRef<Tabs[]>([])
  const [, bump] = useState(0)
  const [sel, setSel] = useState<Sel | null>(null)
  const [box, setBox] = useState<{ beat: Box; note: Box | null } | null>(null)
  const typed = useRef<{ v: string; at: number }>({ v: '', at: 0 })

  const options = useMemo<Option[]>(() => {
    if (!data) return []
    const out: Option[] = []
    data.tracks.forEach((t, i) => {
      if (t.id === 'guitar') {
        const base = t.notes.filter((n) => n.role === 'base').length
        const solo = t.notes.length - base
        out.push({ key: `${i}-all`, track: i, view: 'all', label: 'Guitarra (tudo)', count: t.notes.length })
        out.push({ key: `${i}-base`, track: i, view: 'base', label: 'Guitarra base', count: base })
        out.push({ key: `${i}-solo`, track: i, view: 'solo', label: 'Guitarra solo', count: solo })
      } else out.push({ key: `${i}-all`, track: i, view: 'all', label: t.name, count: t.notes.length })
    })
    return out
  }, [data])
  const [optKey, setOptKey] = useState('')
  const opt = options.find((o) => o.key === optKey) ?? options[0]
  const track = data && opt ? data.tracks[opt.track] : undefined
  const nStr = track?.tuning.length ?? 6

  // o mapa de tempo só depende das batidas (que as edições não mudam)
  const beatsKey = data?.beats
  const timeMap = useMemo(() => (data ? new TimeMap(data) : null), [beatsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const slotsPerBar = useMemo(() => (Number(timeSig.split('/')[0]) || 4) * (data?.grid ?? 4), [timeSig, data?.grid])
  const totalSlots = timeMap ? Math.ceil(timeMap.slotAt(duration)) : 0
  const chordSlots = useMemo(() => (timeMap && chords ? chords.map((c) => ({ slot: timeMap.slotAt(c.t0), name: c.chord })) : []), [timeMap, chords])
  const texOpts = useMemo(() => ({ title, view: opt?.view ?? 'all', slotsPerBar, bpm: data?.bpm ?? 120, totalSlots, chords: chordSlots }), [title, opt?.view, slotsPerBar, data?.bpm, totalSlots, chordSlots])

  // cria o alphaTab uma vez
  const hasData = !!data
  useEffect(() => {
    if (!hasData || !hostRef.current || !scrollRef.current || !timeMap) return
    const api = new alphaTab.AlphaTabApi(hostRef.current, {
      core: { fontDirectory: new URL('./font/', document.baseURI).href, useWorkers: false, includeNoteBounds: true },
      display: {
        layoutMode: 'page',
        scale,
        resources: {
          staffLineColor: '#34497a',
          barSeparatorColor: '#46598a',
          barNumberColor: '#8090b3',
          mainGlyphColor: '#f3e6c8',
          secondaryGlyphColor: '#c4b48faa',
          scoreInfoColor: '#f3e6c8',
        },
      },
      notation: { elements: { scoreTitle: false, scoreSubTitle: false, scoreArtist: false, scoreWordsAndMusic: false, guitarTuning: true, chordDiagrams: false } },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledExternalMedia,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableUserInteraction: true,
        scrollElement: scrollRef.current,
        scrollOffsetY: -40,
      },
    } as unknown as alphaTab.json.SettingsJson)
    apiRef.current = api
    api.renderFinished.on(() => { setStatus('ready'); setRenderTick((n) => n + 1) })
    api.error.on((e) => { console.error(e); setStatus('error') })

    // clique no desenho -> seleção para edição
    const slotOf = (beat: alphaTab.model.Beat) => beatsRef.current[beat.voice.bar.index]?.[beat.index]
    api.beatMouseDown.on((beat) => {
      const slot = slotOf(beat)
      if (slot !== undefined) setSel((s) => ({ slot, string: s?.string ?? 1 }))
    })
    api.noteMouseDown.on((note) => {
      const slot = slotOf(note.beat)
      const strings = note.beat.voice.bar.staff.tuning.length || 6
      if (slot !== undefined) setSel({ slot, string: strings - note.string + 1 })
    })

    const tm = timeMap
    const attach = () => {
      const output = api.player?.output as unknown as alphaTab.synth.IExternalMediaSynthOutput | undefined
      if (!output) return
      output.handler = {
        get backingTrackDuration() { return tm.realToVirtualMs(audio.duration || duration) },
        get playbackRate() { return audio.playbackRate },
        set playbackRate(v: number) { audio.playbackRate = v },
        get masterVolume() { return 1 },
        set masterVolume(_v: number) { /* volume fica no mixer da página */ },
        seekTo(ms: number) { audio.currentTime = Math.max(0, tm.virtualMsToReal(ms)) },
        play() { void audio.play() },
        pause() { audio.pause() },
      }
    }
    api.playerReady.on(attach)
    attach()

    // relógio: posição do áudio -> cursor do alphaTab
    let raf = 0, lastT = -1
    const tick = () => {
      const t = audio.currentTime
      if (Math.abs(t - lastT) > 0.02) {
        lastT = t
        const output = api.player?.output as unknown as alphaTab.synth.IExternalMediaSynthOutput | undefined
        output?.updatePosition(tm.realToVirtualMs(t))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onPlay = () => { try { (api as unknown as { play(): void }).play() } catch { /* ignore */ } }
    const onPause = () => { try { api.pause() } catch { /* ignore */ } }
    // ao pular (com a música parada), traz o cursor para a tela
    const sc = scrollRef.current
    const onSeeked = () => window.setTimeout(() => {
      const c = sc.querySelector('.at-cursor-beat') as HTMLElement | null
      if (!c) return
      const cr = c.getBoundingClientRect(), sr = sc.getBoundingClientRect()
      if (cr.top < sr.top + 20 || cr.bottom > sr.bottom - 20) sc.scrollTo({ top: sc.scrollTop + cr.top - sr.top - 80, behavior: 'smooth' })
    }, 120)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('seeked', onSeeked)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('seeked', onSeeked)
      api.destroy()
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, audio, timeMap])

  // conteúdo: faixa escolhida -> alphaTex
  useEffect(() => {
    const api = apiRef.current
    if (!api || !track) return
    const { tex, beats } = trackToTex(track, texOpts)
    beatsRef.current = beats
    api.tex(staff === 'tabs' ? tex.replace('\\staff {score tabs}', '\\staff {tabs}') : tex)
  }, [track, texOpts, staff])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.settings.display.scale = scale
    api.updateSettings()
    api.render()
  }, [scale])

  useEffect(() => { setSel(null) }, [optKey])

  // ---------- som das notas ----------
  const synthRef = useRef<TabSynth | null>(null)
  useEffect(() => {
    if (sound === 'original') return
    const sy = new TabSynth(audio)
    synthRef.current = sy
    return () => { sy.destroy(); synthRef.current = null }
  }, [sound, audio])
  useEffect(() => {
    const sy = synthRef.current
    if (!sy || !track || !timeMap) return
    const notes = track.notes.filter((n) => n.q0 >= 0 && (!opt || opt.view === 'all' || n.role === opt.view)).map((n) => {
      const time = timeMap.timeAt(n.q0)
      return { time, dur: timeMap.timeAt(n.q0 + (n.qd || 1)) - time, pitch: n.pitch }
    })
    sy.setNotes(notes, track.tuning.length === 4)
    sy.setVolume(sound === 'both' ? 0.7 : 1)
  }, [sound, track, opt, timeMap])

  // ---------- edição ----------
  const visible = useCallback((n: TabNote) => !opt || opt.view === 'all' || n.role === opt.view, [opt])
  const selNote = useMemo(() => (track && sel ? track.notes.find((n) => n.q0 === sel.slot && n.string === sel.string && visible(n)) : undefined), [track, sel, visible])

  const commit = useCallback((fn: (notes: TabNote[]) => TabNote[]) => {
    if (!data || !opt) return
    const tracks = data.tracks.map((t, i) => (i === opt.track ? { ...t, notes: fn(t.notes).sort((a, b) => a.q0 - b.q0 || a.string - b.string) } : t))
    const next = { ...data, tracks }
    past.current.push(data); if (past.current.length > 200) past.current.shift()
    future.current = []
    setData(next); onChange?.(next); bump((n) => n + 1)
  }, [data, opt, onChange])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev || !data) return
    future.current.push(data); setData(prev); onChange?.(prev); bump((n) => n + 1)
  }, [data, onChange])
  const redo = useCallback(() => {
    const nxt = future.current.pop()
    if (!nxt || !data) return
    past.current.push(data); setData(nxt); onChange?.(nxt); bump((n) => n + 1)
  }, [data, onChange])

  const setFret = useCallback((fret: number) => {
    if (!sel || !track || !timeMap || !opt) return
    fret = Math.max(0, Math.min(MAX_FRET, fret))
    const pitch = track.tuning[sel.string - 1] + fret
    commit((notes) => {
      const i = notes.findIndex((n) => n.q0 === sel.slot && n.string === sel.string && visible(n))
      if (i >= 0) return notes.map((n, j) => (j === i ? { ...n, fret, pitch } : n))
      const qd = 2
      const t0 = timeMap.timeAt(sel.slot)
      return [...notes, {
        t0, t1: timeMap.timeAt(sel.slot + qd), pitch, vel: 0.7, string: sel.string, fret,
        q0: sel.slot, qd, role: opt.view === 'solo' ? 'solo' : 'base',
      }]
    })
  }, [sel, track, timeMap, opt, commit, visible])

  const remove = useCallback(() => {
    if (!selNote) return
    commit((notes) => notes.filter((n) => n !== selNote))
  }, [selNote, commit])

  const moveString = useCallback((dir: -1 | 1) => {
    if (!selNote || !track || !sel) return
    const to = sel.string + dir
    if (to < 1 || to > nStr) return
    const fret = selNote.pitch - track.tuning[to - 1]
    if (fret < 0 || fret > MAX_FRET) return
    if (track.notes.some((n) => n.q0 === sel.slot && n.string === to && visible(n))) return
    commit((notes) => notes.map((n) => (n === selNote ? { ...n, string: to, fret } : n)))
    setSel({ slot: sel.slot, string: to })
  }, [selNote, track, sel, nStr, commit, visible])

  const setDur = useCallback((qd: number) => {
    if (!selNote || !timeMap) return
    commit((notes) => notes.map((n) => (n.q0 === selNote.q0 && visible(n) ? { ...n, qd, t1: timeMap.timeAt(n.q0 + qd) } : n)))
  }, [selNote, timeMap, commit, visible])

  const toggleRole = useCallback(() => {
    if (!selNote) return
    const role = selNote.role === 'base' ? 'solo' : 'base'
    commit((notes) => notes.map((n) => (n === selNote ? { ...n, role } : n)))
  }, [selNote, commit])

  // teclado (só quando há seleção na tablatura)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      const mod = e.ctrlKey || e.metaKey
      let done = true
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) undo()
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) redo()
      else if (!sel || mod) done = false
      else if (/^[0-9]$/.test(e.key)) {
        const now = Date.now()
        const prev = now - typed.current.at < 800 ? typed.current.v : ''
        const v = prev + e.key
        const f = Number(v) <= MAX_FRET ? v : e.key
        typed.current = { v: f, at: now }
        setFret(Number(f))
      } else if (e.key === 'Delete' || e.key === 'Backspace') remove()
      else if (e.key === 'ArrowUp' && e.altKey) moveString(-1)
      else if (e.key === 'ArrowDown' && e.altKey) moveString(1)
      else if (e.key === 'ArrowUp') setSel({ ...sel, string: Math.max(1, sel.string - 1) })
      else if (e.key === 'ArrowDown') setSel({ ...sel, string: Math.min(nStr, sel.string + 1) })
      else if (e.key === 'ArrowLeft') setSel({ ...sel, slot: Math.max(0, sel.slot - 1) })
      else if (e.key === 'ArrowRight') setSel({ ...sel, slot: sel.slot + 1 })
      else if (e.key === '+' || e.key === '=') { if (selNote) setDur(Math.min(16, (selNote.qd || 1) * 2)) }
      else if (e.key === '-') { if (selNote) setDur(Math.max(1, Math.floor((selNote.qd || 2) / 2))) }
      else if (e.key.toLowerCase() === 'b') toggleRole()
      else if (e.key === 'Escape') setSel(null)
      else done = false
      if (done) { e.preventDefault(); e.stopImmediatePropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel, selNote, nStr, undo, redo, setFret, remove, moveString, setDur, toggleRole])

  // marcação visual da seleção (sobre o desenho do alphaTab)
  useEffect(() => {
    const api = apiRef.current
    if (!sel || !api?.score || !api.boundsLookup) { setBox(null); return }
    const bar = Math.floor(sel.slot / slotsPerBar)
    const slots = beatsRef.current[bar]
    const b = api.score.tracks[0]?.staves[0]?.bars[bar]?.voices[0]
    if (!slots || !b) { setBox(null); return }
    let idx = 0
    slots.forEach((s, i) => { if (s <= sel.slot) idx = i })
    const beat = b.beats[idx]
    const bb = beat && api.boundsLookup.findBeat(beat)
    if (!bb) { setBox(null); return }
    // posição dentro do tempo (quando o tempo selecionado cai no meio de uma pausa)
    const nextSlot = slots[idx + 1] ?? (bar + 1) * slotsPerBar
    const frac = (sel.slot - slots[idx]) / Math.max(1, nextSlot - slots[idx])
    const vb = bb.visualBounds, rb = bb.realBounds
    const nb = bb.notes?.find((n) => nStr - n.note.string + 1 === sel.string)
    const mb = bb.barBounds.masterBarBounds.visualBounds
    setBox({
      beat: { x: rb.x + frac * rb.w, y: mb.y, w: Math.max(14, vb.w), h: mb.h },
      note: nb ? { x: nb.noteHeadBounds.x - 3, y: nb.noteHeadBounds.y - 2, w: nb.noteHeadBounds.w + 6, h: nb.noteHeadBounds.h + 4 } : null,
    })
  },[sel, renderTick, slotsPerBar, nStr])

  // ---------- exportação ----------
  const exportGp = () => {
    const api = apiRef.current
    if (!api?.score) return
    const bytes = new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings)
    download(`${safeName(title)} - ${opt?.label ?? 'tab'}.gp`, bytes as unknown as BlobPart, 'application/octet-stream')
    setExportOpen(false)
  }
  const exportXml = () => {
    if (!track) return
    download(`${safeName(title)} - ${opt?.label ?? 'tab'}.musicxml`, trackToMusicXml(track, texOpts), 'application/vnd.recordare.musicxml+xml')
    setExportOpen(false)
  }
  const [pdfBusy, setPdfBusy] = useState(false)
  const exportPdf = async () => {
    setExportOpen(false); setSel(null)
    if (!track || pdfBusy) return
    setPdfBusy(true)
    try {
      const { tex } = trackToTex(track, texOpts)
      const chips = [opt?.label, data?.bpm ? `${Math.round(data.bpm)} BPM` : '', timeSig ? `Compasso ${timeSig}` : ''].filter(Boolean) as string[]
      await exportTabPdf({
        tex: staff === 'tabs' ? tex.replace('\\staff {score tabs}', '\\staff {tabs}') : tex,
        title, subtitle: 'Tablatura', chips,
        fileName: `${safeName(title)} - ${opt?.label ?? 'tab'}.pdf`,
      })
    } catch (e) {
      alert('Não foi possível gerar o PDF da tablatura: ' + String((e as Error)?.message ?? e))
    } finally { setPdfBusy(false) }
  }

  if (!data || !data.tracks.length) {
    return (
      <div className="mx-auto max-w-[620px] px-6 py-16 text-center">
        <p className="text-body font-medium text-n12">Tablatura ainda não gerada</p>
        <p className="mt-2 text-sm2 leading-relaxed text-n10">
          A tablatura precisa das faixas separadas. Abra o Josué pelo atalho (servidor local ligado),
          volte para a biblioteca, exclua esta música e envie de novo: o processamento vai separar as faixas e
          transcrever a guitarra e o baixo.
        </p>
      </div>
    )
  }

  const pill = (on: boolean) => `h-8 whitespace-nowrap rounded-r4 px-3 text-caption font-semibold transition ${on ? 'bg-n12 text-n1' : 'bg-n3 text-n11 hover:bg-n4 hover:text-n12'}`
  const tool = 'h-8 min-w-8 rounded-r4 bg-n3 px-2 text-caption font-semibold text-n11 transition hover:bg-n4 hover:text-n12 disabled:opacity-35 disabled:hover:bg-n3'
  const bar = sel ? Math.floor(sel.slot / slotsPerBar) + 1 : 0
  const beatInBar = sel ? (sel.slot % slotsPerBar) / (data.grid || 4) + 1 : 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-gold/25 px-4 py-2 md:px-6">
        {options.map((o) => (
          <button key={o.key} className={pill(o.key === opt?.key)} onClick={() => setOptKey(o.key)} title={`${o.count} notas`}>{o.label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-n4" />
        <button className={pill(staff === 'tabs')} onClick={() => setStaff('tabs')}>Só tablatura</button>
        <button className={pill(staff === 'both')} onClick={() => setStaff('both')}>Partitura + tab</button>
        {setSound && (
          <>
            <span className="mx-1 h-5 w-px bg-n4" />
            <label className="flex items-center gap-1.5 text-caption text-n10">Som
              <select value={sound} onChange={(e) => setSound(e.target.value as TabSound)} title="O que tocar ao dar play"
                className="h-8 rounded-r4 border border-n5 bg-n3 px-2 text-caption font-semibold text-n12 outline-none focus:border-gold">
                <option value="original">Gravação original</option>
                <option value="notes">Só as notas da tab</option>
                <option value="both">Gravação + notas</option>
              </select>
            </label>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={undo} disabled={!past.current.length} className={tool} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">↶</button>
          <button onClick={redo} disabled={!future.current.length} className={tool} title="Refazer (Ctrl+Y)" aria-label="Refazer">↷</button>
          <button onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))} className="h-8 w-8 rounded-r4 text-caption text-n10 hover:bg-n3 hover:text-n12" aria-label="Diminuir">A−</button>
          <button onClick={() => setScale((s) => Math.min(1.6, +(s + 0.1).toFixed(2)))} className="h-8 w-8 rounded-r4 text-sm2 text-n10 hover:bg-n3 hover:text-n12" aria-label="Aumentar">A+</button>
          <div className="relative">
            <button onClick={() => setExportOpen((v) => !v)} className={pill(exportOpen)} aria-expanded={exportOpen} disabled={pdfBusy}>{pdfBusy ? 'Gerando PDF…' : 'Exportar ▾'}</button>
            {exportOpen && (
              <div className="absolute right-0 top-9 z-30 w-[230px] rounded-r5 border border-n5 bg-n3 p-1 shadow-2xl shadow-black/60" onMouseLeave={() => setExportOpen(false)}>
                {[
                  { f: exportGp, t: 'Guitar Pro (.gp)', d: 'Abre no Guitar Pro, TuxGuitar, MuseScore' },
                  { f: exportXml, t: 'MusicXML', d: 'Partitura + tab para outros editores' },
                  { f: () => void exportPdf(), t: 'PDF', d: 'A tablatura inteira, pronta para imprimir' },
                ].map((x) => (
                  <button key={x.t} onClick={x.f} className="block w-full rounded-r4 px-3 py-2 text-left hover:bg-n4">
                    <span className="block text-sm2 font-semibold text-n12">{x.t}</span>
                    <span className="block text-caption text-n10">{x.d}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* riffs e solos: os trechos sem voz, para estudar direto o que importa */}
      {parts && parts.length > 0 && (
        <div className="no-print no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-gold/25 px-4 py-1.5 md:px-6">
          <span className="shrink-0 text-caption font-semibold text-n11">🎸 Riffs e solos:</span>
          {parts.map((p, i) => (
            <button key={i} onClick={() => { audio.currentTime = p.t0; if (audio.paused) void audio.play() }} title={`Tocar a partir de ${formatT(p.t0)} (até ${formatT(p.t1)})`}
              className="shrink-0 rounded-full border border-gold/50 px-2.5 py-0.5 text-caption text-n12 hover:bg-gold/15">
              {p.label} <span className="font-mono text-n10">{formatT(p.t0)}–{formatT(p.t1)}</span>
            </button>
          ))}
        </div>
      )}

      {/* barra de edição */}
      <div className="no-print flex min-h-[44px] flex-wrap items-center gap-2 border-b border-gold/25 px-4 py-1.5 md:px-6">
        {!sel ? (
          <p className="text-caption text-n10">
            Clique numa nota ou num espaço para editar. Teclado: <b className="text-n11">0–9</b> casa · <b className="text-n11">↑↓</b> corda · <b className="text-n11">←→</b> tempo ·
            <b className="text-n11"> Alt+↑↓</b> mesma nota em outra corda · <b className="text-n11">+ −</b> duração · <b className="text-n11">B</b> base/solo · <b className="text-n11">Del</b> apagar
          </p>
        ) : (
          <>
            <span className="text-caption text-n10">Compasso <b className="text-n12">{bar}</b> · tempo <b className="text-n12">{Number.isInteger(beatInBar) ? beatInBar : beatInBar.toFixed(2)}</b> · corda <b className="text-n12">{sel.string}</b></span>
            <span className="mx-1 h-5 w-px bg-n4" />
            <label className="flex items-center gap-1 text-caption text-n10">Casa
              <input
                key={`${sel.slot}-${sel.string}-${selNote?.fret ?? ''}`}
                type="number" min={0} max={MAX_FRET} defaultValue={selNote?.fret ?? ''} placeholder="–"
                onKeyDown={(e) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value; if (v !== '') setFret(Number(v)); (e.target as HTMLInputElement).blur() } }}
                onBlur={(e) => { const v = e.target.value; if (v !== '' && Number(v) !== selNote?.fret) setFret(Number(v)) }}
                className="h-8 w-14 rounded-r4 border border-n5 bg-n2 px-2 text-sm2 text-n12 outline-none focus:border-gold"
              />
            </label>
            <button className={tool} disabled={!selNote} onClick={() => moveString(-1)} title="Mesma nota, corda de cima (Alt+↑)">Corda ↑</button>
            <button className={tool} disabled={!selNote} onClick={() => moveString(1)} title="Mesma nota, corda de baixo (Alt+↓)">Corda ↓</button>
            <span className="mx-1 h-5 w-px bg-n4" />
            {DURS.map((d) => (
              <button key={d.slots} disabled={!selNote} onClick={() => setDur(d.slots)} title={d.title}
                className={`${tool} text-[15px] ${selNote && (selNote.qd || 1) === d.slots ? '!bg-gold !text-n1' : ''}`}>{d.label}</button>
            ))}
            {track?.id === 'guitar' && (
              <>
                <span className="mx-1 h-5 w-px bg-n4" />
                <button className={tool} disabled={!selNote} onClick={toggleRole} title="Mover entre guitarra base e solo (B)">
                  {selNote ? (selNote.role === 'base' ? 'Base → Solo' : 'Solo → Base') : 'Base/Solo'}
                </button>
              </>
            )}
            <button className={`${tool} hover:!text-amber`} disabled={!selNote} onClick={remove} title="Apagar nota (Del)">Apagar</button>
            <button className="ml-auto h-8 rounded-r4 px-2 text-caption text-n10 hover:text-n12" onClick={() => setSel(null)}>Fechar (Esc)</button>
          </>
        )}
      </div>

      <div ref={scrollRef} className="tabview print-area relative min-h-0 flex-1 overflow-y-auto px-2 pb-40 md:px-6">
        {status === 'loading' && <p className="absolute left-1/2 top-10 -translate-x-1/2 text-sm2 text-n10">Desenhando a tablatura…</p>}
        {status === 'error' && <p className="py-10 text-center text-sm2 text-amber">Não consegui desenhar a tablatura.</p>}
        <div className="relative">
          <div ref={hostRef} />
          {box && (
            <div className="no-print pointer-events-none absolute inset-0 z-10">
              <div className="absolute rounded-sm bg-gold/10 ring-1 ring-gold/40" style={{ left: box.beat.x - 4, top: box.beat.y, width: box.beat.w + 8, height: box.beat.h }} />
              {box.note && <div className="absolute rounded-sm ring-2 ring-gold" style={{ left: box.note.x, top: box.note.y, width: box.note.w, height: box.note.h }} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const formatT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
