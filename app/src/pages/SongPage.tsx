import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { touchSong, getAudio, getSetlist, getSong, patchSong, subscribe } from '../lib/db'
import { reviewChords } from '../lib/review'
import { labelSections } from '../lib/sections'
import { detectModulation } from '../lib/modulation'
import { suggestPicking } from '../lib/rhythm'
import { CompareKeys, JamPanel } from '../components/JamTools'
import { bestCapo, buildBars, degreeOf, hardestChanges } from '../lib/theory'
import { ChangeTrainer, ChordDictionary, EarTraining, VoicingsDialog } from '../components/ChordTools'
import { ChordCheckPanel, RhythmView, ScalePanel, useChordCheck } from '../components/MusicianPanels'
import { noteKey } from '../components/CifraView'
import { DIAGRAM_TUNINGS, getDiagramTuning, setDiagramTuning, type DiagramTuning } from '../lib/diagrams'
import { bassForSong } from '../lib/pipeline'
import { forgetLearning, recordCorrection } from '../lib/learn'
import type { Setlist } from '../lib/types'
import { buildCifra, chordAtTime, timeForSyllable } from '../lib/cifra'
import { preferFlats, simplifyChord, transposeChord, transposeKey, transposeOptions } from '../lib/chords'
import { exportChordPro, exportPdf, exportTxt, printCifra } from '../lib/exporters'
import { decodeFile, formatTime, sliceToWav } from '../lib/audio'
import { chordServerAlive, chordsFromServer, patchServerSong } from '../lib/api'
import { loadSettings } from '../lib/settings'
import { powerChordsForSong, swapsOf, unpowerForSong } from '../lib/pipeline'
import { beatGrid, click, suggestStrum } from '../lib/rhythm'
import { retry } from '../lib/pipeline'
import { STEPS, type ChordEvent, type Section, type Song, type Word } from '../lib/types'
import type { Instrument } from '../lib/diagrams'
import { navigate } from '../App'
import CifraView, { type Layers } from '../components/CifraView'
import Player from '../components/Player'
import Mixer, { useStemPlayer, visibleStems, type MixState } from '../components/Mixer'
import TabView, { type TabSound } from '../components/TabView'
import LyricsDialog from '../components/LyricsDialog'
import TunerDialog from '../components/TunerDialog'
import ShortcutsHelp, { SONG_KEYS } from '../components/ShortcutsHelp'
import GpPage from './GpPage'
import { PROJECTOR_CHANNEL, openProjector } from './ProjectorPage'
import EditPopover, { type EditTarget } from '../components/EditPopover'
import { ChordDiagram } from '../components/ChordDiagram'
import { Cover } from '../components/Cover'
import { IArrowLeft, IChevron, IClose, IDownload, IEdit, IGrid, IPrinter, IRetry, ITuner, IUndo } from '../components/Icons'

type Doc = Pick<Song, 'title' | 'words' | 'chords' | 'sections'>

export default function SongPage({ id }: { id: string }) {
  const [song, setSong] = useState<Song | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = () => getSong(id).then((s) => alive && setSong((prev) => {
      // durante a edição local mantemos o que está na tela
      if (prev && prev.status === 'ready' && s && s.status === 'ready' && prev.updatedAt >= s.updatedAt) return prev
      return s ?? null
    }))
    load()
    const un = subscribe(load)
    return () => { alive = false; un() }
  }, [id])

  if (song === undefined) return <div className="grid min-h-dvh place-items-center text-n10">Carregando…</div>
  if (song === null) return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div><p className="text-[18px]">Música não encontrada.</p><button onClick={() => navigate('/')} className="mt-4 text-gold hover:underline">Voltar para a biblioteca</button></div>
    </div>
  )
  if (song.gp) return <GpPage song={song} />
  if (song.status !== 'ready') return <Processing song={song} />
  return <Ready key={song.id} initial={song} />
}

function BackButton() {
  return (
    <button onClick={() => navigate('/')} className="flex h-9 items-center gap-1 rounded-r4 pl-1 pr-3 text-sm2 text-n11 hover:bg-n3 hover:text-n12" aria-label="Voltar para a biblioteca">
      <IArrowLeft size={20} /> <span className="hidden sm:inline">Biblioteca</span>
    </button>
  )
}

function Processing({ song }: { song: Song }) {
  return (
    <div className="mx-auto min-h-dvh max-w-[640px] px-5 py-6">
      <BackButton />
      <div className="mt-6 flex items-center gap-4">
        <Cover hue={song.hue} size={64} />
        <div className="min-w-0">
          <h1 className="truncate text-title font-medium">{song.title}</h1>
          <p className="text-sm2 text-n10">{song.fileName}{song.meta.duration ? ` · ${formatTime(song.meta.duration)}` : ''}</p>
        </div>
      </div>
      <div className="mt-8 rounded-r5 border border-n3 bg-n2 p-5">
        {song.status === 'error' ? (
          <div>
            <p className="text-[16px] font-medium text-error">Não deu certo</p>
            <p className="mt-1 text-sm2 text-n11">{song.error}</p>
            <button onClick={() => retry(song.id)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-r4 bg-n12 px-4 text-sm2 font-semibold text-n1"><IRetry size={18} /> Tentar de novo</button>
          </div>
        ) : (
          <>
            <p className="text-[16px] font-medium">{song.status === 'queued' ? 'Na fila' : `Processando (etapa ${Math.max(1, song.step)}/${STEPS.length})`}</p>
            <p className="mt-1 min-h-5 text-sm2 text-n10">{song.stepLabel ?? (song.status === 'queued' ? 'Aguardando a vez…' : '')}</p>
            <ol className="mt-5 flex flex-col gap-3">
              {STEPS.map((label, i) => {
                const n = i + 1
                const state = song.status === 'queued' ? 'todo' : n < song.step ? 'done' : n === song.step ? 'doing' : 'todo'
                return (
                  <li key={label} className="flex items-center gap-3">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${state === 'done' ? 'bg-mint/15 text-mint' : state === 'doing' ? 'bg-gold text-n1' : 'bg-n4 text-n10'}`}>{state === 'done' ? '✓' : n}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm2 ${state === 'todo' ? 'text-n9' : 'text-n12'}`}>{label}</p>
                      {state === 'doing' && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-n4"><div className="h-full rounded-full bg-gold transition-all duration-300" style={{ width: `${Math.max(3, song.progress * 100)}%` }} /></div>}
                    </div>
                  </li>
                )
              })}
            </ol>
            <p className="mt-6 text-caption text-n9">Pode voltar para a biblioteca: o processamento continua enquanto esta aba estiver aberta.</p>
          </>
        )}
      </div>
    </div>
  )
}

function useAudio(id: string) {
  const audio = useMemo(() => { const a = new Audio(); a.preload = 'auto'; (a as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true; return a }, [])
  const [url, setUrl] = useState('')
  useEffect(() => {
    let u = ''
    let alive = true
    const tryLoad = async (n = 0) => {
      const blob = await getAudio(id)
      if (!alive) return
      if (!blob) { if (n < 20) setTimeout(() => tryLoad(n + 1), 400); return }
      u = URL.createObjectURL(blob)
      audio.src = u
      setUrl(u)
    }
    void tryLoad()
    return () => { alive = false; audio.pause(); if (u) URL.revokeObjectURL(u) }
  }, [id, audio])
  return { audio, url }
}

function Ready({ initial }: { initial: Song }) {
  const [doc, setDoc] = useState<Doc>({ title: initial.title, words: initial.words, chords: initial.chords, sections: initial.sections })
  const history = useRef<Doc[]>([])
  const meta = initial.meta
  const { audio, url } = useAudio(initial.id)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(meta.duration)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(1)
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null })
  const loopRef = useRef(loop); loopRef.current = loop

  const [layers, setLayers] = useState<Layers>({ lyrics: true, chords: true, sections: true })
  // Simples (facilitada) ou Avançado (o acorde completo, como no original): a escolha fica lembrada
  const [simple, setSimpleState] = useState(() => { try { return localStorage.getItem('josue.chordMode') !== 'avancado' } catch { return true } })
  const setSimple = (v: boolean) => { setSimpleState(v); try { localStorage.setItem('josue.chordMode', v ? 'simples' : 'avancado') } catch { /* */ } }
  const [pcBusy, setPcBusy] = useState(false)
  const [pcMsg, setPcMsg] = useState('')
  // ---- ferramentas do músico ----
  const [degrees, setDegreesState] = useState(() => { try { return localStorage.getItem('josue.degrees') === '1' } catch { return false } })
  const setDegrees = (v: boolean) => { setDegreesState(v); try { localStorage.setItem('josue.degrees', v ? '1' : '0') } catch { /* */ } }
  const [checkOn, setCheckOn] = useState(false)
  const [scalesOpen, setScalesOpen] = useState(false)
  const [dictOpen, setDictOpen] = useState(false)
  const [earOpen, setEarOpen] = useState(false)
  const [trainerOpen, setTrainerOpen] = useState(false)
  const [voicing, setVoicing] = useState<{ name: string; prev?: string } | null>(null)
  const [diagTuning, setDiagTuningState] = useState<DiagramTuning>(getDiagramTuning())
  const changeDiagTuning = (t: DiagramTuning) => { setDiagramTuning(t); setDiagTuningState(t) }
  const [notes, setNotes] = useState(initial.notes ?? [])
  const [bassBusy, setBassBusy] = useState(false)
  const [jamOpen, setJamOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [redoOpen, setRedoOpen] = useState(false)
  const [redoBusy, setRedoBusy] = useState(false)
  const [semis, setSemis] = useState(0)
  const [capo, setCapo] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [instrument, setInstrument] = useState<Instrument>('violao')
  const [panelOpen, setPanelOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [edit, setEdit] = useState<EditTarget | null>(null)
  const [fontSize, setFontSize] = useState(() => (window.innerWidth < 640 ? 15 : 18))
  const [mix, setMix] = useState<MixState>({})
  const [mixerOpen, setMixerOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  // repertório (quando a música foi aberta a partir de um) e modo palco
  const params = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] || ''), [])
  const [setNav, setSetNav] = useState<{ sl: Setlist; i: number } | null>(null)
  const [stage, setStage] = useState(params.get('palco') === '1')
  const [stageFont, setStageFontState] = useState(() => { try { return Number(localStorage.getItem('josue.stageFont')) || 30 } catch { return 30 } })
  const setStageFont = (f: number) => { setStageFontState(f); try { localStorage.setItem('josue.stageFont', String(f)) } catch { /* */ } }
  const [reviewOn, setReviewOn] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [tunerOpen, setTunerOpen] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // "tocadas recentemente" na biblioteca
  useEffect(() => { void touchSong(initial.id, { lastOpenedAt: Date.now() }) }, [initial.id])
  const [view, setView] = useState<'cifra' | 'tab' | 'compassos'>('cifra')
  const [tabSound, setTabSound] = useState<TabSound>('original')
  const stemPlayer = useStemPlayer(audio, initial.stems, mix, view === 'tab' && tabSound === 'notes')

  // relógio do player (10 atualizações por segundo bastam para a tela)
  useEffect(() => {
    let raf = 0, last = -1
    const tick = () => {
      const t = audio.currentTime
      const l = loopRef.current
      if (l.a !== null && l.b !== null && t >= l.b) { audio.currentTime = l.a; onWrapRef.current() }
      const q = Math.floor(t * 10)
      if (q !== last) { last = q; setTime(t) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onPlay = () => setPlaying(true), onPause = () => setPlaying(false)
    const onMeta = () => isFinite(audio.duration) && setDuration(audio.duration)
    audio.addEventListener('play', onPlay); audio.addEventListener('pause', onPause); audio.addEventListener('loadedmetadata', onMeta)
    return () => { cancelAnimationFrame(raf); audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause); audio.removeEventListener('loadedmetadata', onMeta) }
  }, [audio])

  const setSpeed = (s: number) => { setSpeedState(s); audio.playbackRate = s; (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true }

  // treino progressivo: a cada volta do loop A-B, +10% de velocidade até chegar em 100%
  const [progressive, setProgressive] = useState(false)
  const onWrapRef = useRef<() => void>(() => {})
  onWrapRef.current = () => {
    if (!progressive) return
    const next = Math.min(1, Math.round((audio.playbackRate + 0.1) * 10) / 10)
    if (next !== audio.playbackRate) setSpeed(next)
  }
  const toggleProgressive = () => {
    const on = !progressive
    setProgressive(on)
    if (on && audio.playbackRate >= 1) setSpeed(0.7)
  }

  // metrônomo: segue as batidas detectadas (acento no 1º tempo do compasso)
  const [metro, setMetro] = useState(false)
  useEffect(() => {
    if (!metro) return
    const grid = beatGrid(initial.beats, meta.bpm, duration || meta.duration)
    const perBar = meta.timeSig === '3/4' ? 3 : meta.timeSig === '6/8' ? 6 : 4
    let i = grid.findIndex((b) => b >= audio.currentTime)
    let lastT = audio.currentTime
    const id = window.setInterval(() => {
      const t = audio.currentTime
      if (t < lastT - 0.2 || t > lastT + 1) i = grid.findIndex((b) => b >= t) // pulou (seek/loop)
      lastT = t
      if (audio.paused || i < 0) return
      while (i < grid.length && grid[i] <= t) {
        if (t - grid[i] < 0.08) click(i % perBar === 0)
        i++
      }
    }, 15)
    return () => clearInterval(id)
  }, [metro, audio, initial.beats, meta.bpm, meta.timeSig, meta.duration, duration])
  // tela da congregação: manda a posição da música para a janela do projetor
  useEffect(() => {
    const ch = new BroadcastChannel(PROJECTOR_CHANNEL)
    const id = window.setInterval(() => ch.postMessage({ songId: initial.id, time: audio.currentTime, playing: !audio.paused }), 200)
    return () => { clearInterval(id); ch.close() }
  }, [audio, initial.id])
  const strum = useMemo(() => suggestStrum(meta.timeSig, meta.bpm), [meta.timeSig, meta.bpm])
  const picking = useMemo(() => suggestPicking(meta.timeSig, meta.bpm), [meta.timeSig, meta.bpm])
  // quadro "Ritmo" (batida + dedilhado), aberto pela etiqueta abaixo do título
  const [rhythmOpen, setRhythmOpen] = useState(false)
  const rhythmBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!rhythmOpen) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-rhythm]')) setRhythmOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [rhythmOpen])

  // "minha parte": tira a guitarra (ou a faixa de instrumentos) para tocar junto com o resto da banda
  const myPartStem = useMemo(() => { const v = visibleStems(initial.stems); return v.find((s) => s.name === 'guitar') ?? v.find((s) => s.name === 'other') }, [initial.stems])
  const myPart = !!myPartStem && !!mix[myPartStem.name]?.mute
  const studyActive = [reviewOn, metro, progressive, myPart, checkOn, scalesOpen, degrees].filter(Boolean).length
  // menu "Estudo" (fica fora da barra rolável para não ser cortado)
  const [studyOpen, setStudyOpen] = useState(false)
  const studyBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!studyOpen) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-study]')) setStudyOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [studyOpen])
  const toggleMyPart = () => {
    if (!myPartStem) return
    setMix((m) => ({ ...m, [myPartStem.name]: { vol: m[myPartStem.name]?.vol ?? 1, solo: false, mute: !myPart } }))
  }

  const seek = useCallback((t: number) => { audio.currentTime = Math.max(0, t); }, [audio])
  const onLoop = () => {
    const t = audio.currentTime
    if (loop.a === null) setLoop({ a: t, b: null })
    else if (loop.b === null) setLoop(t > loop.a + 0.3 ? { a: loop.a, b: t } : { a: null, b: null })
    else setLoop({ a: null, b: null })
  }

  // teclado: espaço, setas
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.code === 'Space') { e.preventDefault(); audio.paused ? void audio.play() : audio.pause() }
      else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5)
      else if (e.key === 'ArrowRight') audio.currentTime = audio.currentTime + 5
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if (e.ctrlKey || e.metaKey || e.altKey) return
      else if (e.key === '?') setHelpOpen((v) => !v)
      else {
        const k = e.key.toLowerCase()
        const t = audio.currentTime
        if (k === 'a') setLoop({ a: t, b: loop.b !== null && loop.b > t + 0.3 ? loop.b : null })
        else if (k === 'b') { if (loop.a !== null && t > loop.a + 0.3) setLoop({ a: loop.a, b: t }) }
        else if (k === 'p') { if (stage) exitStage(); else enterStage() }
        else if (k === 'c') setLiveOpen((v) => !v)
        else if (k === 't') setTunerOpen((v) => !v)
        else if (k === 'm') setMetro((v) => !v)
        else if (k === 'j') openProjector(initial.id)
        else if (k === 'r') setReviewOn((v) => !v)
        else if (k === 'e') { setEditMode((v) => !v); setEdit(null) }
        else if (k === 'g') setDegrees(!degrees)
        else if (k === 's') setScalesOpen((v) => !v)
        else if (k === 'k') setCheckOn((v) => !v)
        else if (k === 'd') setDictOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- exibição: transposição, capotraste e modo simples ----
  const shift = semis - capo
  const soundingKey = meta.key ? transposeKey(meta.key, semis) : ''
  const shapeKey = meta.key ? transposeKey(meta.key, shift) : ''
  const flats = preferFlats(shapeKey)
  const display = useCallback((c: string) => {
    const t = transposeChord(c, shift, flats)
    return simple ? simplifyChord(t, flats) : t
  }, [shift, flats, simple])

  // na tablatura as casas são as reais (sem tom/capo), então os acordes vão no tom original
  const tabChords = useMemo(() => doc.chords.map((c) => ({ ...c, chord: simple ? simplifyChord(c.chord, preferFlats(meta.key || '')) : c.chord })), [doc.chords, simple, meta.key])
  // 7. mudança de tom no meio da música (ex.: o último refrão sobe meio tom)
  const modulation = useMemo(() => detectModulation(doc.chords, doc.sections, meta.key), [doc.chords, doc.sections, meta.key])
  const modKey = modulation ? transposeKey(modulation.key, shift) : ''
  const shownSections = useMemo(() => {
    const ls = labelSections(doc.sections, doc.words)
    return modulation ? ls.map((x) => (Math.abs(x.t0 - modulation.t0) < 0.2 ? { ...x, label: `${x.label} · sobe para ${modKey}` } : x)) : ls
  }, [doc.sections, doc.words, modulation, modKey])
  // graus (I–IV–V) no lugar dos nomes, em relação ao tom dos desenhos
  const cifraDisplay = useCallback((c: string) => (degrees ? degreeOf(display(c), shapeKey) : display(c)), [degrees, display, shapeKey])
  const blocks = useMemo(() => buildCifra(doc.words, doc.chords, layers.sections ? shownSections : [], cifraDisplay), [doc, cifraDisplay, layers.sections, shownSections])
  const lines = useMemo(() => blocks.flatMap((b) => b.lines), [blocks])
  const activeLine = useMemo(() => {
    let k = -1
    for (let i = 0; i < lines.length; i++) if (lines[i].t0 <= time + 0.15) k = i
    return k
  }, [lines, time])
  const activeChord = chordAtTime(doc.chords, time)
  const usedChords = useMemo(() => {
    const seen: string[] = []
    for (const c of doc.chords) { const n = display(c.chord); if (!seen.includes(n)) seen.push(n) }
    return seen
  }, [doc.chords, display])
  const activeName = activeChord >= 0 ? display(doc.chords[activeChord].chord) : ''

  // ---- músico: "tocou certo?", capo inteligente, trocas difíceis, compassos, anotações, baixo ----
  const soundingFlats = preferFlats(soundingKey)
  const soundingOf = useCallback((i: number) => transposeChord(docRef.current.chords[i]?.chord ?? '', semis, soundingFlats), [semis, soundingFlats])
  const check = useChordCheck(checkOn, activeChord, soundingOf, playing)
  const capoTips = useMemo(() => bestCapo(doc.chords, semis), [doc.chords, semis])
  const bestTip = capoTips[0]
  const curTip = capoTips.find((t) => t.capo === capo)
  const capoBetter = !!bestTip && !!curTip && bestTip.capo !== capo && bestTip.openShare - curTip.openShare >= 0.15
  const prevOf = useCallback((name: string) => {
    const cnt = new Map<string, number>()
    doc.chords.forEach((c, i) => {
      if (!i || display(c.chord) !== name) return
      const p = display(doc.chords[i - 1].chord)
      if (p !== name) cnt.set(p, (cnt.get(p) ?? 0) + 1)
    })
    let best: string | undefined, n = 0
    cnt.forEach((v, k) => { if (v > n) { n = v; best = k } })
    return best
  }, [doc.chords, display])
  const changePairs = useMemo(() => hardestChanges(doc.chords.map((c) => ({ ...c, chord: display(c.chord) }))), [doc.chords, display])
  const beatsPerBar = meta.timeSig === '3/4' ? 3 : meta.timeSig === '6/8' ? 6 : 4
  const bars = useMemo(() => (view === 'compassos' ? buildBars(doc.chords, beatGrid(initial.beats, meta.bpm, duration || meta.duration), beatsPerBar, shownSections) : []),
    [view, doc.chords, initial.beats, meta.bpm, duration, meta.duration, beatsPerBar, shownSections])
  // trechos sem voz de pelo menos 6 s: intro, solos, instrumentais (atalhos na tablatura)
  const instrumentalParts = useMemo(() => {
    const end = duration || meta.duration
    const ws = doc.words
    const gaps: { t0: number; t1: number }[] = []
    let last = 0
    for (const w of ws) { if (w.t0 - last >= 6) gaps.push({ t0: last, t1: w.t0 }); last = Math.max(last, w.t1) }
    if (end - last >= 6) gaps.push({ t0: last, t1: end })
    return gaps.map((g) => {
      const sec = shownSections.find((x) => x.t0 <= g.t0 + 2 && x.t1 > g.t0)
      const lab = sec && /intro|solo|instrumental|final|ponte/i.test(sec.label) ? sec.label : g.t0 < 1 ? 'Intro' : end - g.t1 < 1 ? 'Final' : 'Instrumental'
      return { label: lab, t0: g.t0, t1: g.t1 }
    })
  }, [doc.words, duration, meta.duration, shownSections])
  const notesMap = useMemo(() => new Map(notes.map((n) => [noteKey(n.t0), n.text])), [notes])
  const [noteEdit, setNoteEdit] = useState<{ t0: number; text: string } | null>(null)
  const editNote = (t0: number) => setNoteEdit({ t0, text: notes.find((n) => noteKey(n.t0) === noteKey(t0))?.text ?? '' })
  const saveNote = (t0: number, text: string) => {
    const next = notes.filter((n) => noteKey(n.t0) !== noteKey(t0))
    if (text.trim()) next.push({ t0, text: text.trim() })
    next.sort((a, b) => a.t0 - b.t0)
    setNotes(next); setNoteEdit(null)
    void patchSong(initial.id, { notes: next })
  }
  const redoRange = async (t0: number, t1: number, label: string) => {
    setRedoOpen(false); setRedoBusy(true); setPcMsg(`Refazendo os acordes de ${label}…`)
    try {
      if (!(await chordServerAlive())) throw new Error('ligue o servidor local (abra o Josué pelo atalho)')
      const blob = await getAudio(initial.id)
      if (!blob) throw new Error('áudio não encontrado')
      const wav = sliceToWav(await decodeFile(blob), t0, t1)
      const got = (await chordsFromServer(wav, 'trecho.wav')).map((c) => ({ ...c, t0: c.t0 + t0, t1: Math.min(t1, c.t1 + t0) }))
      if (!got.length) throw new Error('nenhum acorde reconhecido no trecho')
      const keep = docRef.current.chords
        .map((c) => (c.t0 < t0 && c.t1 > t0 ? { ...c, t1: t0 } : c)) // acorde que entra no trecho termina no início dele
        .filter((c) => c.t1 <= t0 + 0.05 || c.t0 >= t1 - 0.05)
      commit({ ...docRef.current, chords: [...keep, ...got].sort((a, b) => a.t0 - b.t0) })
      setPcMsg(`${label}: ${got.length} acordes refeitos · Ctrl+Z desfaz`)
    } catch (e) { setPcMsg('Não deu: ' + (e as Error).message) } finally { setRedoBusy(false); setTimeout(() => setPcMsg(''), 9000) }
  }
  const detectBass = async () => {
    setBassBusy(true); setPcMsg('')
    try {
      const out = await bassForSong(initial, docRef.current.chords, preferFlats(meta.key))
      const n = out.filter((c, i) => c.chord !== docRef.current.chords[i]?.chord).length
      if (n) commit({ ...docRef.current, chords: out })
      setPcMsg(n ? `${n} inversões encontradas no baixo (ex.: D/F#) · Ctrl+Z desfaz` : 'Nenhuma inversão encontrada no baixo')
    } catch (e) { setPcMsg('Não deu: ' + (e as Error).message) } finally { setBassBusy(false); setTimeout(() => setPcMsg(''), 9000) }
  }

  // ---- repertório: tom/capo do item e navegação para a anterior/próxima ----
  useEffect(() => {
    const sid = params.get('set')
    const i = Number(params.get('i'))
    if (!sid) return
    void getSetlist(sid).then((sl) => {
      if (!sl) return
      setSetNav({ sl, i })
      const it = sl.items[i]
      if (it && it.songId === initial.id) { setSemis(it.semis); setCapo(it.capo ?? 0) }
    })
  }, [params, initial.id])
  const goSet = useCallback((d: number) => {
    if (!setNav) return
    const j = setNav.i + d
    const it = setNav.sl.items[j]
    if (!it) return
    navigate(`/musica/${it.songId}?set=${setNav.sl.id}&i=${j}${stage ? '&palco=1' : ''}`)
  }, [setNav, stage])

  // ---- modo palco: tela cheia, letra grande, sem distrações ----
  const enterStage = () => {
    setStage(true); setAutoScroll(true); setEditMode(false); setEdit(null)
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const exitStage = () => { setStage(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) }
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setStage(false) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  // pedal de virar página (Bluetooth) costuma mandar PageDown/PageUp: próxima/anterior do repertório
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'PageDown' && setNav) { e.preventDefault(); goSet(1) }
      else if (e.key === 'PageUp' && setNav) { e.preventDefault(); goSet(-1) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [goSet, setNav])

  // ---- revisão guiada dos acordes ----
  const [learnTick, setLearnTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allFlags = useMemo(() => reviewChords(doc.chords, meta.key), [doc.chords, meta.key, learnTick, reviewOn])
  const flagKey = (i: number) => `${doc.chords[i]?.t0.toFixed(2)}|${doc.chords[i]?.chord}`
  const flags = useMemo(() => allFlags.filter((f) => !dismissed.has(flagKey(f.index))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allFlags, dismissed])
  const flagMap = useMemo(() => (reviewOn ? new Map(flags.map((f) => [f.index, f.reason])) : undefined), [reviewOn, flags])
  const setChordOriginal = (i: number, name: string) => { recordCorrection(docRef.current.chords[i].chord, name); setChordOriginalRaw(i, name) }
  const setChordOriginalRaw = (i: number, name: string) => commit({ ...docRef.current, chords: docRef.current.chords.map((c, k) => (k === i ? { ...c, chord: name } : c)) })
  const dismiss = (i: number) => setDismissed((s) => new Set(s).add(flagKey(i)))
  const learnedFlags = flags.filter((f) => f.kind === 'aprendido' && f.suggestion)
  // aplica de uma vez todas as trocas aprendidas (sem "reaprender" com elas)
  const applyLearned = () => {
    const map = new Map(learnedFlags.map((f) => [f.index, f.suggestion!]))
    commit({ ...docRef.current, chords: docRef.current.chords.map((c, k) => (map.has(k) ? { ...c, chord: map.get(k)! } : c)) })
  }

  // ---- power chords em música já processada ----
  // liga/desliga: troca só os acordes que viraram power chord (o resto das edições fica como está)
  const [powerSwap, setPowerSwap] = useState(initial.powerSwap)
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02
  const isPower = (c: string) => /^[A-G][#b]?5$/.test(c)
  // sem registro (músicas convertidas antes): ligado = a cifra tem power chords
  const powerOn = powerSwap ? powerSwap.some((s) => doc.chords.some((c) => near(c.t0, s.t0) && c.chord === s.power)) : doc.chords.some((c) => isPower(c.chord))
  const applySwap = (toPower: boolean) => {
    if (!powerSwap) return
    commit({ ...docRef.current, chords: docRef.current.chords.map((c) => {
      const s = powerSwap.find((x) => near(x.t0, c.t0) && c.chord === (toPower ? x.normal : x.power))
      return s ? { ...c, chord: toPower ? s.power : s.normal } : c
    }) })
  }
  const findPowerChords = async () => {
    setPcMsg('')
    if (powerSwap) { // já sabemos quais são: só alterna
      applySwap(!powerOn)
      if (!powerOn) setSimple(false)
      setPcMsg(powerOn ? 'Acordes normais (sem power chord)' : `${powerSwap.length} power chords`)
      setTimeout(() => setPcMsg(''), 5000)
      return
    }
    setPcBusy(true)
    try {
      const before = docRef.current.chords
      if (powerOn) {
        // power chords sem registro do original: descobre no áudio se cada um era maior ou menor
        const normal = await unpowerForSong(initial, before)
        const swaps = swapsOf(normal, before)
        setPowerSwap(swaps)
        void patchSong(initial.id, { powerSwap: swaps })
        commit({ ...docRef.current, chords: normal })
        setPcMsg('Acordes normais (sem power chord) · clique de novo para voltar aos power chords')
        return
      }
      const { chords, changed } = await powerChordsForSong(initial, before)
      if (changed) {
        const swaps = swapsOf(before, chords)
        setPowerSwap(swaps)
        void patchSong(initial.id, { powerSwap: swaps })
        commit({ ...docRef.current, chords }); setSimple(false)
      }
      setPcMsg(changed ? `${changed} acordes viraram power chord · clique de novo para voltar aos normais` : 'Nenhum power chord encontrado nesta música')
    } catch (e) { setPcMsg('Não deu: ' + (e as Error).message) }
    finally { setPcBusy(false); setTimeout(() => setPcMsg(''), 9000) }
  }

  // rolagem automática (pausa 4 s quando a pessoa rola sozinha)
  const userScrollAt = useRef(0)
  useEffect(() => {
    const mark = () => { userScrollAt.current = performance.now() }
    window.addEventListener('wheel', mark, { passive: true }); window.addEventListener('touchmove', mark, { passive: true })
    return () => { window.removeEventListener('wheel', mark); window.removeEventListener('touchmove', mark) }
  }, [])
  useEffect(() => {
    if (!autoScroll || activeLine < 0 || editMode || performance.now() - userScrollAt.current < 4000) return
    const el = document.querySelector(`[data-line="${activeLine}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeLine, autoScroll, editMode])

  // ---- edição ----
  const docRef = useRef(doc); docRef.current = doc
  const commit = useCallback((next: Doc) => {
    const prev = docRef.current
    history.current.push(prev)
    if (history.current.length > 100) history.current.shift()
    setDoc(next)
    void persist(initial, next)
    // destaca por alguns segundos os acordes que mudaram (power, inversões, revisão, edição…)
    const changed = next.chords.map((c, i) => (prev.chords.some((p) => Math.abs(p.t0 - c.t0) < 0.02 && p.chord === c.chord) ? -1 : i)).filter((i) => i >= 0)
    if (changed.length && changed.length < next.chords.length + 1) {
      setFlash(new Set(changed))
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlash(new Set()), 6000)
    }
  }, [initial])
  const [flash, setFlash] = useState<Set<number>>(new Set())
  const flashTimer = useRef(0)
  function undo() {
    const prev = history.current.pop()
    if (!prev) return
    setDoc(prev)
    void persist(initial, prev)
  }
  const toOriginal = useCallback((name: string) => transposeChord(name, -shift), [shift])

  const fixChords = (cs: ChordEvent[]) => {
    const s = [...cs].sort((a, b) => a.t0 - b.t0)
    for (let i = 0; i < s.length - 1; i++) if (s[i].t1 > s[i + 1].t0) s[i] = { ...s[i], t1: s[i + 1].t0 }
    return s.map((c) => (c.t1 - c.t0 < 0.2 ? { ...c, t1: c.t0 + 0.2 } : c))
  }
  const renameChord = (i: number, name: string) => { recordCorrection(docRef.current.chords[i].chord, toOriginal(name)); renameChordRaw(i, name) }
  const renameChordRaw = (i: number, name: string) => commit({ ...docRef.current, chords: docRef.current.chords.map((c, k) => (k === i ? { ...c, chord: toOriginal(name) } : c)) })
  const removeChord = (i: number) => commit({ ...docRef.current, chords: docRef.current.chords.filter((_, k) => k !== i) })
  const addChord = (wi: number, off: number, name: string) => {
    const d = docRef.current
    const t0 = timeForSyllable(d.words[wi], off)
    const next = d.chords.find((c) => c.t0 > t0)
    commit({ ...d, chords: fixChords([...d.chords, { t0, t1: next ? next.t0 : t0 + 2, chord: toOriginal(name) }]) })
  }
  const moveChord = useCallback((ci: number, wi: number, off: number) => {
    const d = docRef.current
    const c = d.chords[ci]
    if (!c) return
    const t0 = timeForSyllable(d.words[wi], off)
    const len = Math.max(0.5, c.t1 - c.t0)
    const rest = d.chords.filter((_, k) => k !== ci)
    const next = rest.find((x) => x.t0 > t0)
    commit({ ...d, chords: fixChords([...rest, { ...c, t0, t1: next ? Math.min(next.t0, t0 + len * 4) : t0 + len }]) })
  }, [commit])
  const editWord = (wi: number, text: string) => {
    const d = docRef.current
    const w = d.words[wi]
    const parts = text.trim().split(/\s+/).filter(Boolean)
    let repl: Word[] = []
    if (parts.length === 1) repl = [{ ...w, text: parts[0] }]
    else if (parts.length > 1) {
      const total = parts.reduce((a, p) => a + p.length, 0)
      let t = w.t0
      repl = parts.map((p) => { const dur = ((w.t1 - w.t0) * p.length) / total; const x = { t0: t, t1: t + dur, text: p }; t += dur; return x })
    }
    commit({ ...d, words: [...d.words.slice(0, wi), ...repl, ...d.words.slice(wi + 1)] })
  }
  const renameSection = (si: number, label: string) => commit({ ...docRef.current, sections: docRef.current.sections.map((s, k) => (k === si ? { ...s, label } : s)) })
  const splitSection = (wi: number) => {
    const d = docRef.current
    const t = Math.max(0, d.words[wi].t0 - 0.05)
    const secs = d.sections.length ? d.sections : [{ t0: 0, t1: duration || 1e9, label: 'Verso' }]
    const k = secs.findIndex((s) => t > s.t0 + 0.2 && t < s.t1)
    if (k < 0) return
    const s = secs[k]
    commit({ ...d, sections: [...secs.slice(0, k), { ...s, t1: t }, { t0: t, t1: s.t1, label: 'Verso' }, ...secs.slice(k + 1)] })
  }
  const mergeSection = (k: number) => {
    const d = docRef.current
    if (k <= 0) return
    const secs = d.sections.map((s) => ({ ...s }))
    secs[k - 1].t1 = secs[k].t1
    secs.splice(k, 1)
    commit({ ...d, sections: secs })
  }
  const setTitle = (title: string) => { const d = { ...docRef.current, title }; setDoc(d); void persist(initial, d) }

  const onChordClick = useCallback((index: number, el: HTMLElement) => setEdit({ kind: 'chord', index, name: display(docRef.current.chords[index].chord), rect: el.getBoundingClientRect() }), [display])
  const onSyllableClick = useCallback((wordIndex: number, offset: number, el: HTMLElement) => setEdit({ kind: 'syllable', wordIndex, offset, word: docRef.current.words[wordIndex].text, rect: el.getBoundingClientRect() }), [])
  const onSectionClick = useCallback((index: number, el: HTMLElement) => setEdit({ kind: 'section', index, label: docRef.current.sections[index]?.label ?? '', rect: el.getBoundingClientRect() }), [])

  // ---- exportar ----
  const exportMeta = { title: doc.title, key: shapeKey || '?', bpm: meta.bpm, timeSig: meta.timeSig, capo, transpose: semis }
  const doExport = (kind: 'pdf' | 'txt' | 'cho' | 'print') => {
    setExportOpen(false)
    const b = buildCifra(doc.words, doc.chords, shownSections, display)
    if (kind === 'pdf') exportPdf(b, exportMeta, layers, notesMap)
    else if (kind === 'txt') exportTxt(b, exportMeta, layers)
    else if (kind === 'cho') exportChordPro(b, exportMeta)
    else printCifra(b, exportMeta, layers)
  }

  const chip = 'flex items-center gap-1 rounded-r4 bg-n3 px-2 h-8 text-caption text-n11 whitespace-nowrap'
  const toggle = (on: boolean) => `h-9 rounded-r4 px-3 2xl:px-4 text-caption font-semibold transition whitespace-nowrap ${on ? 'gold-btn text-n1' : 'bg-n3/80 text-n12 hover:bg-n4'}`
  const selectCls = 'h-9 rounded-r4 border border-gold/60 bg-n1/70 px-2 text-caption text-n12 outline-none focus:border-gold/60'

  // botões de ação: no computador ficam na linha do título; em telas menores, na barra de ferramentas
  const tools = (
    <>
      <button onClick={enterStage} title="Tela cheia, letra grande e sem distrações — para tocar no culto ou no ensaio" className="gold-btn flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 px-2.5 text-caption font-bold text-n1">▶ <span className="xl:max-2xl:hidden">Modo palco</span></button>
      <button onClick={() => { setEditMode((v) => !v); setEdit(null) }} aria-pressed={editMode} title="Editar a cifra (E)" className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 px-2.5 text-caption font-semibold ${editMode ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}>
        <IEdit size={16} /> <span className="xl:max-2xl:hidden">{editMode ? 'Concluir edição' : 'Editar'}</span>
      </button>
      <button onClick={() => setLiveOpen((v) => !v)} aria-pressed={liveOpen} title="Mostra o acorde que está tocando agora, trocando junto com a música" className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 px-2.5 text-caption font-semibold ${liveOpen ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}><IGrid size={16} /> <span className="xl:max-2xl:hidden">Acorde atual</span></button>
      <button onClick={() => openProjector(initial.id)} title="Abre uma janela só com a letra, grande, para o telão da igreja (J)" className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 bg-n3 px-2.5 text-caption font-semibold text-n12 hover:bg-n4">📽 <span className="xl:max-2xl:hidden">Projetor</span></button>
      <button onClick={() => setTunerOpen(true)} title="Afinar o instrumento pelo microfone" className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 bg-n3 px-2.5 text-caption font-semibold text-n12 hover:bg-n4"><ITuner size={16} className="text-gold" /> <span className="xl:max-2xl:hidden">Afinador</span></button>
      <button onClick={() => setLyricsOpen(true)} title="Colar a letra certa e sincronizar com a música" className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 bg-n3 px-2.5 text-caption font-semibold text-n12 hover:bg-n4">📝 <span className="xl:max-2xl:hidden">Letra…</span></button>
      <button onClick={() => setMixerOpen((v) => !v)} aria-pressed={mixerOpen} title="Ouvir voz, guitarra, baixo e bateria separados" className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 px-2.5 text-caption font-semibold ${stemPlayer.active ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
        <span className="xl:max-2xl:hidden">Faixas{visibleStems(initial.stems).length ? ` (${visibleStems(initial.stems).length})` : ''}</span>
      </button>
    </>
  )

  return (
    <div className="min-h-dvh bg-bg bg-fixed bg-cover bg-top pb-[150px]" style={{ backgroundImage: 'url(./img/fundo-musica.webp)' }}>
      {/* cabeçalho */}
      {!stage && (
      <header className="sticky top-0 z-30 border-b border-gold/20 bg-n1/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-3 py-3 md:px-6">
          <BackButton />
          <img src="./img/josue-96.png" alt="" width={56} height={56} className="hidden h-14 w-14 shrink-0 rounded-r5 ring-2 ring-gold/70 shadow-[0_4px_20px_#e8b43740] sm:block" />
          <div className="min-w-0 flex-1">
            <input
              value={doc.title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Título da música"
              className="w-full truncate rounded-r3 border border-transparent bg-transparent px-1 text-[17px] font-medium text-n12 outline-none hover:border-n4 focus:border-gold/60 md:text-[20px]"
            />
            <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto px-1">
              <span className={chip}><b className="font-semibold text-n12">{meta.bpm || '–'}</b> BPM</span>
              <span className={chip}>Tom <b className="font-semibold text-gold">{soundingKey || '–'}</b></span>
              <span className={chip} title="Compasso"><b className="font-semibold text-n12">{meta.timeSig || '–'}</b></span>
              <span className={chip} title="Duração">{formatTime(duration)}</span>
              <button ref={rhythmBtn} data-rhythm onClick={() => setRhythmOpen((v) => !v)} aria-expanded={rhythmOpen} title="Batida e dedilhado sugeridos" className={chip + ' hover:bg-n4 hover:text-n12'}>🥁 Ritmo</button>
              {modulation && <span className={chip + ' text-amber'} title={`Modulação: a música sobe para ${modKey} em ${formatTime(modulation.t0)}`}>↑ <b className="font-semibold text-gold">{modKey}</b></span>}
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 xl:flex">{tools}</div>
          <div className="relative">
            <button onClick={() => setExportOpen((v) => !v)} className="flex h-10 items-center gap-2 rounded-r5 border-2 border-gold/80 bg-n1/60 px-4 text-sm2 font-semibold text-n12 hover:bg-n2/80" aria-haspopup="menu" aria-expanded={exportOpen}>
              <IDownload size={18} /> <span className="hidden sm:inline">Exportar</span> <IChevron size={16} className="hidden sm:block" />
            </button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-r5 border border-n5 bg-n3 py-1 shadow-2xl shadow-black/60">
                {([['pdf', 'PDF da cifra'], ['txt', 'Texto (.txt)'], ['cho', 'ChordPro (.cho)'], ['print', 'Imprimir']] as const).map(([k, l]) => (
                  <button key={k} role="menuitem" onClick={() => doExport(k)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm2 text-n12 hover:bg-n4">
                    {k === 'print' ? <IPrinter size={16} /> : <IDownload size={16} />} {l}
                  </button>
                ))}
                <p className="border-t border-n5 px-4 py-2 text-[11px] text-n9">Sai como está na tela: tom, capotraste e camadas.</p>
              </div>
            )}
          </div>
        </div>

        {/* barra de ferramentas */}
        <div className="no-scrollbar mx-auto flex max-w-[1440px] items-center gap-1.5 overflow-x-auto px-3 pb-3 md:px-6 2xl:gap-2">
          <div className="flex shrink-0 gap-1.5" role="tablist" aria-label="Visualização">
            <button role="tab" aria-selected={view === 'cifra'} className={toggle(view === 'cifra')} onClick={() => setView('cifra')}>Cifra</button>
            <button role="tab" aria-selected={view === 'tab'} className={toggle(view === 'tab')} onClick={() => setView('tab')}><span className="2xl:hidden">Tab</span><span className="hidden 2xl:inline">Tablatura</span>{initial.tabs ? '' : ' ·'}</button>
            <button role="tab" aria-selected={view === 'compassos'} className={toggle(view === 'compassos')} onClick={() => setView('compassos')} title="Cifra em compassos: quantos tempos cada acorde dura">Compassos</button>
          </div>
          <span className="h-6 w-px shrink-0 bg-n4" />
          <div className="flex shrink-0 gap-1.5" role="group" aria-label="Camadas">
            <button className={toggle(layers.lyrics)} aria-pressed={layers.lyrics} onClick={() => setLayers({ ...layers, lyrics: !layers.lyrics })}>Letra</button>
            <button className={toggle(layers.chords)} aria-pressed={layers.chords} onClick={() => setLayers({ ...layers, chords: !layers.chords })}>Acordes</button>
            <button className={toggle(layers.sections)} aria-pressed={layers.sections} onClick={() => setLayers({ ...layers, sections: !layers.sections })}>Seções</button>
          </div>
          <div className="flex shrink-0 gap-1.5" role="group" aria-label="Modo dos acordes">
            <button className={toggle(simple)} aria-pressed={simple} onClick={() => setSimple(true)}>Simples</button>
            <button className={toggle(!simple)} aria-pressed={!simple} onClick={() => setSimple(false)}>Avançado</button>
            <button onClick={() => void findPowerChords()} disabled={pcBusy} aria-pressed={powerOn}
              title={powerOn ? 'Power chords ligados (D5, E5…). Clique para voltar aos acordes normais.' : powerSwap ? 'Clique para mostrar os power chords desta música' : 'Procurar power chords na guitarra (tônica e quinta, sem terça)'}
              className={toggle(powerOn)}>{pcBusy ? 'Procurando…' : '🎸 Power'}</button>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-caption text-n10"><span className="hidden 2xl:inline">Tom</span>
            <select className={selectCls} value={semis} onChange={(e) => setSemis(Number(e.target.value))} aria-label="Transpor tom">
              {meta.key ? transposeOptions(meta.key).map((o) => <option key={o.semis} value={o.semis}>{o.label}</option>)
                : Array.from({ length: 13 }, (_, i) => i - 6).map((s) => <option key={s} value={s}>{s > 0 ? '+' : ''}{s} semitons</option>)}
            </select>
          </label>
          <label className="flex shrink-0 items-center gap-1.5 text-caption text-n10"><span className="hidden 2xl:inline">Capo</span>
            <select className={selectCls} value={capo} onChange={(e) => setCapo(Number(e.target.value))} aria-label="Capotraste">
              <option value={0}>Sem capotraste</option>
              {Array.from({ length: 7 }, (_, i) => i + 1).map((c) => <option key={c} value={c}>Casa {c}{capoBetter && bestTip.capo === c ? ' ★ sugerido' : ''}</option>)}
            </select>
          </label>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button onClick={() => setFontSize((f) => Math.max(12, f - 1))} className="h-8 w-8 rounded-r4 text-caption text-n10 hover:bg-n3 hover:text-n12" aria-label="Diminuir letra">A−</button>
            <button onClick={() => setFontSize((f) => Math.min(28, f + 1))} className="h-8 w-8 rounded-r4 text-sm2 text-n10 hover:bg-n3 hover:text-n12" aria-label="Aumentar letra">A+</button>
            <button onClick={() => setHelpOpen(true)} title="Atalhos de teclado (?)" aria-label="Atalhos de teclado" className="h-8 w-7 rounded-r4 text-sm2 text-n10 hover:bg-n3 hover:text-n12">⌨</button>
            <button onClick={() => setAutoScroll((v) => !v)} aria-pressed={autoScroll} className={`h-8 whitespace-nowrap rounded-r4 px-2.5 text-caption font-semibold ${autoScroll ? 'text-gold' : 'text-n10 hover:text-n12'}`} title={autoScroll ? 'Rolagem automática (a letra acompanha a música)' : 'Rolagem livre'}>↕ {autoScroll ? 'Auto' : 'Livre'}</button>
            <button data-study ref={studyBtn} onClick={() => setStudyOpen((v) => !v)} aria-expanded={studyOpen} aria-haspopup="menu" title="Revisar acordes, metrônomo, treino progressivo, minha parte e power chords"
              className={`flex h-8 items-center gap-1 whitespace-nowrap rounded-r4 px-2.5 text-caption font-semibold ${studyActive ? 'bg-gold text-n1' : allFlags.length ? 'bg-n3 text-amber hover:bg-n4' : 'bg-n3 text-n12 hover:bg-n4'}`}>
              🎓 <span className="xl:max-2xl:hidden">Estudo</span>{studyActive ? ` (${studyActive})` : ''} <span aria-hidden>▾</span>
            </button>
            {pcMsg && <span role="status" className="whitespace-nowrap text-caption text-gold">{pcMsg}</span>}
            <div className="flex shrink-0 items-center gap-1 xl:hidden">{tools}</div>
            <button onClick={() => setPanelOpen((v) => !v)} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 bg-n3 px-2.5 text-caption font-semibold text-n12 hover:bg-n4 xl:hidden"><IGrid size={16} /> Diagramas</button>
          </div>
        </div>
      </header>
      )}

      {/* repertório */}
      {setNav && !stage && (
        <div className="mx-auto mt-3 flex max-w-[900px] items-center gap-2 rounded-r5 border border-gold/40 bg-n1/70 px-3 py-2 text-caption text-n11 backdrop-blur">
          <button onClick={() => navigate(`/repertorio/${setNav.sl.id}`)} className="truncate font-semibold text-gold hover:underline">☰ {setNav.sl.name}</button>
          <span className="text-n9">· {setNav.i + 1} de {setNav.sl.items.length}</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => goSet(-1)} disabled={setNav.i === 0} className="h-8 rounded-r4 bg-n3 px-3 font-semibold text-n12 hover:bg-n4 disabled:opacity-40">◀ Anterior</button>
            <button onClick={() => goSet(1)} disabled={setNav.i >= setNav.sl.items.length - 1} className="h-8 rounded-r4 bg-gold px-3 font-semibold text-n1 disabled:opacity-40">Próxima ▶</button>
          </div>
        </div>
      )}

      {/* barra do modo palco */}
      {stage && (
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-gold/30 bg-n1/90 px-4 py-2 backdrop-blur-md">
          <p className="min-w-0 flex-1 truncate text-[18px] font-semibold text-n12">{doc.title} <span className="ml-2 text-sm2 font-normal text-n10">Tom <b className="text-gold">{soundingKey || '–'}</b>{capo ? ` · capo ${capo}` : ''}</span></p>
          {setNav && (
            <div className="flex items-center gap-1 text-caption text-n10">
              <button onClick={() => goSet(-1)} disabled={setNav.i === 0} className="h-9 rounded-r4 bg-n3 px-3 font-semibold text-n12 disabled:opacity-30" title="Anterior (Page Up)">◀</button>
              <span className="px-1">{setNav.i + 1}/{setNav.sl.items.length}</span>
              <button onClick={() => goSet(1)} disabled={setNav.i >= setNav.sl.items.length - 1} className="h-9 rounded-r4 bg-n3 px-3 font-semibold text-n12 disabled:opacity-30" title="Próxima (Page Down)">▶</button>
            </div>
          )}
          <button onClick={() => setLiveOpen((v) => !v)} aria-pressed={liveOpen} title="Mostra o acorde que está tocando agora (arraste para onde quiser)" className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-r4 px-3 text-sm2 font-semibold ${liveOpen ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`}><IGrid size={16} /> Acorde atual</button>
          <button onClick={() => openProjector(initial.id)} title="Letra para o telão" className="h-9 whitespace-nowrap rounded-r4 bg-n3 px-3 text-sm2 font-semibold text-n12 hover:bg-n4">📽 Projetor</button>
          <button onClick={() => setStageFont(Math.max(18, stageFont - 2))} className="h-9 w-10 rounded-r4 bg-n3 text-sm2 text-n12" aria-label="Letra menor">A−</button>
          <button onClick={() => setStageFont(Math.min(56, stageFont + 2))} className="h-9 w-10 rounded-r4 bg-n3 text-body text-n12" aria-label="Letra maior">A+</button>
          <button onClick={exitStage} className="h-9 rounded-r4 border border-gold/60 px-3 text-sm2 font-semibold text-n12 hover:bg-n3">Sair (Esc)</button>
        </div>
      )}

      {view === 'tab' && (
        <div className="mx-auto flex h-[calc(100dvh-136px-120px)] max-w-[1440px] flex-col px-3 pt-3 md:px-6"><div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border-2 border-gold/60 bg-n1/55 backdrop-blur-sm">
          <TabView tabs={initial.tabs} audio={audio} title={doc.title} timeSig={meta.timeSig || '4/4'} duration={duration} onChange={(tabs) => void patchSong(initial.id, { tabs })} chords={tabChords} sound={tabSound} setSound={setTabSound} parts={instrumentalParts} />
        </div></div>
      )}
      <div className={`mx-auto max-w-[1440px] gap-8 px-4 md:px-6 ${view === 'tab' ? 'hidden' : 'flex'}`}>
        <main className="min-w-0 flex-1 pt-6">
          <div className={`mx-auto ${stage ? 'max-w-[1300px]' : 'max-w-[900px]'} rounded-[18px] border-2 border-gold/60 bg-n1/55 p-5 shadow-[0_0_30px_#e8b4371a] backdrop-blur-sm md:p-8`}>
            {capo > 0 && (
              <p className="mb-5 rounded-r4 border border-n4 bg-n2 px-3 py-2 text-sm2 text-n11">
                Capotraste na <b className="text-n12">{capo}ª casa</b>: toque os desenhos em <b className="text-gold">{shapeKey}</b> para soar em <b className="text-gold">{soundingKey}</b>.
              </p>
            )}
            {editMode && (
              <div className="mb-5 flex flex-wrap items-center gap-3 rounded-r4 border border-gold/30 bg-gold/5 px-3 py-2 text-caption text-n11">
                <span>Clique num acorde para trocar, arraste-o para outra sílaba, clique numa sílaba para corrigir a palavra ou pôr um acorde, e clique numa seção para renomear.</span>
                <button onClick={undo} disabled={!history.current.length} className="ml-auto flex h-7 items-center gap-1 rounded-r3 bg-n4 px-2 font-semibold text-n12 disabled:opacity-40"><IUndo size={14} /> Desfazer</button>
              </div>
            )}
            {!doc.words.length && layers.lyrics && (
              <p className="mb-5 rounded-r4 bg-n2 px-3 py-2 text-sm2 text-n10">Não encontramos letra cantada neste áudio; mostrando só os acordes.</p>
            )}
            {reviewOn && !stage && (
              <div className="mb-5 rounded-r5 border border-amber/50 bg-amber/5 p-3">
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-sm2 font-semibold text-n12">Revisão dos acordes <span className="font-normal text-n10">· {flags.length ? `${flags.length} para conferir` : 'nada suspeito 🎉'}</span></p>
                  <button onClick={() => setReviewOn(false)} aria-label="Fechar revisão" className="grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={16} /></button>
                </div>
                {flags.length > 0 && <p className="mt-1 text-caption text-n10">Os acordes marcados em laranja podem estar errados. Ouça o trecho e escolha: trocar pela sugestão, manter, ou clicar no acorde (no modo Editar) para escolher outro.</p>}
                {learnedFlags.length > 3 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-r4 border border-gold/40 bg-gold/5 px-2 py-2 text-caption">
                    <span className="min-w-0 flex-1 text-n11">🧠 Pelo que você costuma corrigir, <b className="text-n12">{learnedFlags.length} acordes</b> podem trocar (ex.: {display(doc.chords[learnedFlags[0].index].chord)} → {display(learnedFlags[0].suggestion!)}).</span>
                    <button onClick={applyLearned} className="h-7 rounded-r3 bg-gold px-2 font-semibold text-n1">Aplicar em todos</button>
                    <button onClick={() => learnedFlags.forEach((f) => dismiss(f.index))} className="h-7 rounded-r3 bg-n4 px-2 font-semibold text-n12 hover:bg-n5">Ignorar</button>
                    <button onClick={() => { forgetLearning(); setLearnTick((n) => n + 1) }} title="Apaga as trocas que o Josué aprendeu com você" className="h-7 px-1 text-n10 hover:text-n12 hover:underline">Esquecer o que aprendi</button>
                  </div>
                )}
                <div className="mt-2 flex max-h-[240px] flex-col gap-1 overflow-y-auto pr-1">
                  {flags.filter((f) => learnedFlags.length <= 3 || f.kind !== 'aprendido').map((f) => {
                    const c = doc.chords[f.index]
                    return (
                      <div key={f.index + c.chord} className="flex flex-wrap items-center gap-2 rounded-r4 bg-n2/70 px-2 py-1.5 text-caption">
                        <button onClick={() => { seek(Math.max(0, c.t0 - 1.5)); if (audio.paused) void audio.play() }} className="w-12 font-mono text-n10 hover:text-gold" title="Ouvir este trecho">▶ {formatTime(c.t0)}</button>
                        <span className="font-mono text-[14px] font-bold text-amber">{display(c.chord)}</span>
                        <span className="min-w-0 flex-1 text-n11">{f.reason.replace(c.chord, display(c.chord)).replace(meta.key, soundingKey || meta.key)}</span>
                        {f.suggestion && <button onClick={() => setChordOriginal(f.index, f.suggestion!)} className="h-7 rounded-r3 bg-gold px-2 font-semibold text-n1">Trocar por {display(f.suggestion)}</button>}
                        <button onClick={() => dismiss(f.index)} className="h-7 rounded-r3 bg-n4 px-2 font-semibold text-n12 hover:bg-n5">Está certo</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {view === 'compassos' ? <RhythmView bars={bars} time={time} perRow={4} onSeek={seek} display={cifraDisplay} fontSize={stage ? stageFont * 0.8 : fontSize} /> : <CifraView
              blocks={blocks}
              activeLine={activeLine}
              activeChord={activeChord}
              layers={layers}
              editMode={editMode}
              fontSize={stage ? stageFont : fontSize}
              flags={flagMap}
              changed={flash}
              marks={checkOn ? check.marks : undefined}
              notes={notesMap}
              onNote={editNote}
              onSeek={seek}
              onChordClick={onChordClick}
              onSyllableClick={onSyllableClick}
              onSectionClick={onSectionClick}
              onMoveChord={moveChord}
            />}
          </div>
        </main>

        {/* diagramas (computador) */}
        <aside className={`sticky top-[136px] mt-6 hidden h-[calc(100dvh-136px-160px)] w-[300px] shrink-0 flex-col rounded-[18px] border-2 border-gold/60 bg-n1/55 p-4 backdrop-blur-sm ${stage ? '' : 'xl:flex'}`} aria-label="Diagramas de acordes">
          <ChordPanel chords={usedChords} active={activeName} instrument={instrument} setInstrument={setInstrument} onPick={(c) => setVoicing({ name: c, prev: prevOf(c) })} tuning={diagTuning} setTuning={changeDiagTuning} />
        </aside>
      </div>

      {liveOpen && <LiveChord chords={doc.chords} index={activeChord} time={time} display={display} instrument={instrument} setInstrument={setInstrument} onClose={() => setLiveOpen(false)}
        sounding={capo > 0 ? (c) => { const t = transposeChord(c, semis, preferFlats(soundingKey)); return simple ? simplifyChord(t, preferFlats(soundingKey)) : t } : undefined} />}

      {/* diagramas (celular e tablet) */}
      {panelOpen && (
        <div className="fixed inset-x-0 bottom-[104px] z-40 max-h-[55dvh] overflow-hidden rounded-t-r6 border-t border-n4 bg-n2 p-4 shadow-2xl shadow-black/60 xl:hidden">
          <div className="mb-2 flex items-center justify-between"><p className="text-sm2 font-medium">Diagramas de acordes</p><button onClick={() => setPanelOpen(false)} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={18} /></button></div>
          <div className="flex max-h-[calc(55dvh-56px)] flex-col"><ChordPanel chords={usedChords} active={activeName} instrument={instrument} setInstrument={setInstrument} compact onPick={(c) => setVoicing({ name: c, prev: prevOf(c) })} tuning={diagTuning} setTuning={changeDiagTuning} /></div>
        </div>
      )}

      {edit && (
        <EditPopover target={edit} flats={flats} onClose={() => setEdit(null)} onRenameChord={renameChord} onRemoveChord={removeChord} onAddChord={addChord} onEditWord={editWord} onRenameSection={renameSection} onSplitSection={splitSection} onMergeSection={mergeSection} />
      )}

      {studyOpen && studyBtn.current && (() => {
        const r = studyBtn.current.getBoundingClientRect()
        const item = (on: boolean) => `flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-n3 disabled:opacity-40 ${on ? 'text-gold' : 'text-n12'}`
        const check = (on: boolean) => <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[11px] ${on ? 'border-gold bg-gold text-n1' : 'border-n7'}`}>{on ? '✓' : ''}</span>
        return (
          <div data-study role="menu" className="fixed z-50 max-h-[calc(100dvh-170px)] w-[310px] overflow-y-auto rounded-r5 border border-n5 bg-n2 py-1 shadow-2xl shadow-black/60" style={{ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 300, window.innerWidth - 308)) }}>
            <button role="menuitemcheckbox" aria-checked={reviewOn} onClick={() => setReviewOn((v) => !v)} className={item(reviewOn)}>{check(reviewOn)}<span className="flex-1"><b className="block text-sm2">Revisar acordes{flags.length ? ` (${flags.length})` : ''}</b><span className="text-caption text-n10">Marca os acordes que a IA pode ter errado · R</span></span></button>
            <button role="menuitemcheckbox" aria-checked={metro} onClick={() => setMetro((v) => !v)} className={item(metro)}>{check(metro)}<span className="flex-1"><b className="block text-sm2">Metrônomo</b><span className="text-caption text-n10">Clique em cada tempo da música · M</span></span></button>
            <button role="menuitemcheckbox" aria-checked={progressive} onClick={toggleProgressive} disabled={loop.a === null || loop.b === null} className={item(progressive)}>{check(progressive)}<span className="flex-1"><b className="block text-sm2">Treino progressivo{progressive ? ` · ${Math.round(speed * 100)}%` : ''}</b><span className="text-caption text-n10">{loop.a !== null && loop.b !== null ? 'A cada repetição do trecho, +10% de velocidade' : 'Marque antes o trecho com A e B'}</span></span></button>
            {myPartStem && <button role="menuitemcheckbox" aria-checked={myPart} onClick={toggleMyPart} className={item(myPart)}>{check(myPart)}<span className="flex-1"><b className="block text-sm2">Minha parte</b><span className="text-caption text-n10">Tira a {myPartStem.label.toLowerCase()} para você tocar no lugar</span></span></button>}
            <button role="menuitemcheckbox" aria-checked={checkOn} onClick={() => setCheckOn((v) => !v)} className={item(checkOn)}>{check(checkOn)}<span className="flex-1"><b className="block text-sm2">Tocou certo? (microfone)</b><span className="text-caption text-n10">Ouve você tocando e marca acertos e erros · K</span></span></button>
            <button role="menuitemcheckbox" aria-checked={scalesOpen} onClick={() => setScalesOpen((v) => !v)} className={item(scalesOpen)}>{check(scalesOpen)}<span className="flex-1"><b className="block text-sm2">Escalas para solar</b><span className="text-caption text-n10">Escala do tom no braço + notas do acorde atual · S</span></span></button>
            <button role="menuitemcheckbox" aria-checked={degrees} onClick={() => setDegrees(!degrees)} className={item(degrees)}>{check(degrees)}<span className="flex-1"><b className="block text-sm2">Graus (I – IV – V – vi)</b><span className="text-caption text-n10">A cifra em graus do campo harmônico · G</span></span></button>
            <div className="my-1 border-t border-n4" />
            <button role="menuitem" onClick={() => { setStudyOpen(false); setTrainerOpen(true) }} className={item(false)}><span className="w-4 text-center">⇄</span><span className="flex-1"><b className="block text-sm2">Treino de troca de acordes</b><span className="text-caption text-n10">{changePairs[0] ? `As mais difíceis: ${changePairs[0].a} ⇄ ${changePairs[0].b}…` : 'Alternar acordes com metrônomo'}</span></span></button>
            <button role="menuitem" onClick={() => { setStudyOpen(false); setEarOpen(true) }} className={item(false)}><span className="w-4 text-center">👂</span><span className="flex-1"><b className="block text-sm2">Treino de ouvido</b><span className="text-caption text-n10">Ouça um acorde da música e diga qual é</span></span></button>
            <button role="menuitem" onClick={() => { setStudyOpen(false); setDictOpen(true) }} className={item(false)}><span className="w-4 text-center">📖</span><span className="flex-1"><b className="block text-sm2">Dicionário de acordes</b><span className="text-caption text-n10">Qualquer acorde: notas, posições e som</span></span></button>
            <button role="menuitem" onClick={() => { setStudyOpen(false); setJamOpen(true) }} className={item(jamOpen)}><span className="w-4 text-center">🎙</span><span className="flex-1"><b className="block text-sm2">Tocar junto e gravar</b><span className="text-caption text-n10">Banda virtual (bateria + baixo) e grave você tocando</span></span></button>
            <button role="menuitem" onClick={() => { setStudyOpen(false); setCompareOpen(true) }} className={item(false)}><span className="w-4 text-center">⇆</span><span className="flex-1"><b className="block text-sm2">Comparar dois tons</b><span className="text-caption text-n10">A cifra em dois tons, lado a lado</span></span></button>
            <button role="menuitem" onClick={() => { setStudyOpen(false); setRedoOpen(true) }} disabled={redoBusy} className={item(false)}><span className="w-4 text-center">↻</span><span className="flex-1"><b className="block text-sm2">{redoBusy ? 'Refazendo o trecho…' : 'Refazer acordes de um trecho'}</b><span className="text-caption text-n10">A IA ouve de novo só a parte escolhida</span></span></button>
            <button role="menuitem" onClick={() => { setStudyOpen(false); void detectBass() }} disabled={bassBusy} className={item(false)}><span className="w-4 text-center">🎸</span><span className="flex-1"><b className="block text-sm2">{bassBusy ? 'Ouvindo o baixo…' : 'Inversões pelo baixo'}</b><span className="text-caption text-n10">Acha D/F#, C/E… ouvindo o baixo separado</span></span></button>
            {capoBetter && <button role="menuitem" onClick={() => { setStudyOpen(false); setCapo(bestTip.capo) }} className={item(false)}><span className="w-4 text-center">💡</span><span className="flex-1"><b className="block text-sm2">Capo na casa {bestTip.capo}</b><span className="text-caption text-n10">{Math.round(bestTip.openShare * 100)}% da música com acordes abertos (agora: {Math.round((curTip?.openShare ?? 0) * 100)}%)</span></span></button>}
            <div className="my-1 border-t border-n4" />
            <button role="menuitem" onClick={() => { setStudyOpen(false); void findPowerChords() }} disabled={pcBusy} className={item(false)}><span className="w-4 text-center">🎸</span><span className="flex-1"><b className="block text-sm2">{pcBusy ? 'Procurando power chords…' : powerOn ? 'Voltar aos acordes normais' : powerSwap ? 'Mostrar power chords' : 'Procurar power chords'}</b><span className="text-caption text-n10">D5, E5…: tônica e quinta, sem terça</span></span></button>
          </div>
        )
      })()}
      {checkOn && <ChordCheckPanel chord={activeChord >= 0 ? soundingOf(activeChord) : ''} live={check.live} score={check.score} counted={check.counted} err={check.err} onReset={check.reset} onClose={() => setCheckOn(false)} sens={check.sens} setSens={check.setSens} />}
      {scalesOpen && <ScalePanel songKey={shapeKey} chord={activeName} flats={flats} onClose={() => setScalesOpen(false)} />}
      {dictOpen && <ChordDictionary initial={activeName || 'C'} onClose={() => setDictOpen(false)} />}
      {earOpen && <EarTraining chords={usedChords} onClose={() => setEarOpen(false)} />}
      {trainerOpen && <ChangeTrainer pairs={changePairs} onClose={() => setTrainerOpen(false)} />}
      {voicing && <VoicingsDialog name={voicing.name} prev={voicing.prev} onClose={() => setVoicing(null)} />}
      {noteEdit && (
        <div className="fixed inset-0 z-[55] grid place-items-center bg-black/60 p-4" role="dialog" aria-label="Anotação" onMouseDown={(e) => { if (e.target === e.currentTarget) setNoteEdit(null) }}>
          <form onSubmit={(e) => { e.preventDefault(); saveNote(noteEdit.t0, noteEdit.text) }} className="w-full max-w-[460px] rounded-r6 border-2 border-gold/60 bg-n1 p-5 shadow-2xl shadow-black/60">
            <p className="josue-title text-[22px]">Anotação na linha</p>
            <p className="mt-1 text-caption text-n10">Ex.: “dedilhado aqui”, “abafar”, “dobra o refrão”, “solo do teclado”. Aparece na cifra, no palco e no PDF.</p>
            <input autoFocus value={noteEdit.text} onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })} maxLength={120}
              className="mt-3 h-11 w-full rounded-r4 border border-n6 bg-n2 px-3 text-sm2 text-n12 outline-none focus:border-gold" />
            <div className="mt-4 flex gap-2">
              <button type="submit" className="h-9 rounded-r4 bg-gold px-4 text-sm2 font-semibold text-n1">Salvar</button>
              {notesMap.has(noteKey(noteEdit.t0)) && <button type="button" onClick={() => saveNote(noteEdit.t0, '')} className="h-9 rounded-r4 px-3 text-sm2 text-error hover:bg-error/10">Apagar</button>}
              <button type="button" onClick={() => setNoteEdit(null)} className="ml-auto h-9 rounded-r4 px-3 text-sm2 text-n10 hover:text-n12">Cancelar</button>
            </div>
          </form>
        </div>
      )}
      {rhythmOpen && rhythmBtn.current && (() => {
        const r = rhythmBtn.current.getBoundingClientRect()
        return (
          <div data-rhythm role="dialog" aria-label="Ritmo" className="fixed z-50 w-[320px] rounded-r5 border border-n5 bg-n2 p-4 shadow-2xl shadow-black/60" style={{ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 328)) }}>
            <p className="text-caption font-semibold uppercase tracking-wider text-n11">Batida <span className="font-normal normal-case tracking-normal text-n9">· {strum.name}</span></p>
            <p className="mt-1 whitespace-pre font-mono text-[22px] font-bold text-gold">{strum.pattern}</p>
            <p className="text-caption text-n10">{strum.tip}</p>
            <div className="my-3 border-t border-n4" />
            <p className="text-caption font-semibold uppercase tracking-wider text-n11">Dedilhado <span className="font-normal normal-case tracking-normal text-n9">· {picking.name}</span></p>
            <p className="mt-1 font-mono text-[22px] font-bold tracking-[0.2em] text-gold">{picking.pattern.join(' ')}</p>
            <p className="text-caption text-n10">{picking.tip}</p>
            <p className="mt-3 text-[11px] text-n9">{meta.bpm ? `${meta.bpm} BPM · ` : ''}compasso {meta.timeSig || '–'}. Sugestão para começar; ajuste ao seu jeito.</p>
          </div>
        )
      })()}
      {jamOpen && <JamPanel audio={audio} stems={initial.stems} mix={mix} setMix={setMix} onClose={() => setJamOpen(false)} />}
      {compareOpen && <CompareKeys words={doc.words} chords={doc.chords} sections={shownSections} songKey={meta.key} initialA={semis} onClose={() => setCompareOpen(false)} />}
      {redoOpen && (
        <div className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Refazer acordes de um trecho" onMouseDown={(e) => { if (e.target === e.currentTarget) setRedoOpen(false) }}>
          <div className="w-full max-w-[460px] rounded-r6 border-2 border-gold/60 bg-n1 p-5 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between"><p className="josue-title text-[22px]">Refazer acordes</p><button onClick={() => setRedoOpen(false)} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={18} /></button></div>
            <p className="mt-1 text-caption text-n10">Escolha a parte. A IA (modelo treinado, no servidor local) ouve de novo só esse trecho e troca os acordes dele; o resto da cifra não muda. Ctrl+Z desfaz.</p>
            <div className="mt-3 flex max-h-[50dvh] flex-col gap-1 overflow-y-auto">
              {loop.a !== null && loop.b !== null && <button onClick={() => void redoRange(loop.a!, loop.b!, 'o trecho A-B')} className="flex items-center justify-between rounded-r4 border border-gold/50 bg-gold/10 px-3 py-2 text-left text-sm2 text-n12 hover:bg-gold/20"><span>Trecho A-B marcado</span><span className="font-mono text-caption text-n10">{formatTime(loop.a)}–{formatTime(loop.b)}</span></button>}
              {shownSections.map((x, i) => <button key={i} onClick={() => void redoRange(x.t0, x.t1, x.label)} className="flex items-center justify-between rounded-r4 bg-n2 px-3 py-2 text-left text-sm2 text-n12 hover:bg-n3"><span>{x.label}</span><span className="font-mono text-caption text-n10">{formatTime(x.t0)}–{formatTime(x.t1)}</span></button>)}
              {!shownSections.length && loop.a === null && <p className="text-caption text-n10">Esta música não tem seções. Marque um trecho com A e B e volte aqui.</p>}
            </div>
          </div>
        </div>
      )}
      {helpOpen && <ShortcutsHelp keys={SONG_KEYS} onClose={() => setHelpOpen(false)} />}
      {tunerOpen && <TunerDialog onClose={() => setTunerOpen(false)} />}
      {lyricsOpen && (
        <LyricsDialog
          stemsId={initial.stems?.id}
          language={(meta.language && meta.language !== 'auto') ? meta.language : 'pt'}
          currentText={lyricsText(doc.words)}
          onClose={() => setLyricsOpen(false)}
          onDone={(words) => { commit({ ...doc, words }); setLyricsOpen(false) }}
        />
      )}
      {mixerOpen && <Mixer stems={initial.stems} mix={mix} setMix={setMix} error={stemPlayer.error} onClose={() => setMixerOpen(false)} />}

      {url ? (
        <Player audio={audio} url={url} time={time} duration={duration} playing={playing} speed={speed} setSpeed={setSpeed} loop={loop} onLoop={onLoop} />
      ) : (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-n3 bg-n2 px-6 py-6 text-center text-sm2 text-n10">Preparando o áudio…</div>
      )}
    </div>
  )
}

function ChordPanel({ chords, active, instrument, setInstrument, compact = false, onPick, tuning, setTuning }: { chords: string[]; active: string; instrument: Instrument; setInstrument: (i: Instrument) => void; compact?: boolean; onPick?: (c: string) => void; tuning?: DiagramTuning; setTuning?: (t: DiagramTuning) => void }) {
  const tab = (on: boolean) => `h-8 flex-1 rounded-r3 text-caption font-semibold ${on ? 'gold-btn text-n1' : 'bg-n3/80 text-n12 hover:bg-n4'}`
  return (
    <>
      {!compact && <p className="mb-2 text-sm2 font-medium text-n12">Acordes da música</p>}
      <div className="mb-3 flex gap-1 rounded-r4 bg-n2/80 p-1" role="tablist">
        <button className={tab(instrument === 'violao')} onClick={() => setInstrument('violao')}>Violão</button>
        <button className={tab(instrument === 'ukulele')} onClick={() => setInstrument('ukulele')}>Ukulele</button>
        <button className={tab(instrument === 'teclado')} onClick={() => setInstrument('teclado')}>Teclado</button>
      </div>
      {instrument === 'violao' && setTuning && (
        <select value={tuning} onChange={(e) => setTuning(e.target.value as DiagramTuning)} aria-label="Afinação dos desenhos" title="Afinação do seu violão: os desenhos se ajustam" className="mb-2 h-8 w-full shrink-0 rounded-r4 border border-n5 bg-n2 px-2 text-caption text-n12">
          {DIAGRAM_TUNINGS.map((t) => <option key={t.id} value={t.id}>Afinação: {t.name}</option>)}
        </select>
      )}
      <div className={`grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pr-1 ${instrument === 'teclado' ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-1' : compact ? 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]' : 'grid-cols-2'}`}>
        {chords.map((c) => <button key={c + (tuning ?? '')} onClick={() => onPick?.(c)} title="Clique para ver outras posições deste acorde" className="rounded-r4 text-left transition hover:ring-1 hover:ring-gold/60"><ChordDiagram name={c} instrument={instrument} active={c === active} /></button>)}
        {!chords.length && <p className="text-caption text-n9">Nenhum acorde detectado.</p>}
      </div>
    </>
  )
}

async function persist(song: Song, d: Doc) {
  await patchSong(song.id, { title: d.title, words: d.words, chords: d.chords, sections: d.sections as Section[] })
  const s = loadSettings()
  if (song.engine === 'server' && song.serverId && s.serverUrl) {
    try { await patchServerSong(s.serverUrl, song.serverId, d) } catch { /* fica salvo localmente */ }
  }
}

/** Letra atual como texto (uma linha por linha da cifra, se vier de letra colada). */
function lyricsText(words: Word[]): string {
  let out = '', line: number | undefined
  words.forEach((w, i) => {
    const t = w.text.replace(/^\n/, '').trim()
    const brk = i > 0 && (w.line !== undefined ? w.line !== line : /^\n/.test(w.text) || w.t0 - words[i - 1].t1 > 0.8)
    out += (i === 0 ? '' : brk ? '\n' : ' ') + t
    line = w.line
  })
  return out
}

// Painel flutuante "Acorde atual": o desenho do acorde que está soando agora e o próximo,
// trocando junto com a música enquanto a cifra continua rolando por trás.
export function LiveChord({ chords, index, time, display, instrument, setInstrument, onClose, sounding }: {
  chords: { t0: number; t1: number; chord: string }[]; index: number; time: number; display: (c: string) => string
  instrument: Instrument; setInstrument: (i: Instrument) => void; onClose: () => void
  /** com capotraste: o acorde que soa de verdade (para quem toca junto sem capo) */
  sounding?: (c: string) => string
}) {
  const now = index >= 0 ? display(chords[index].chord) : ''
  // próximos acordes diferentes do atual
  const upcoming: { name: string; t0: number }[] = []
  let last = now
  for (let i = index + 1; i < chords.length && upcoming.length < 3; i++) {
    const n = display(chords[i].chord)
    if (n !== last && n !== 'N') { upcoming.push({ name: n, t0: chords[i].t0 }); last = n }
  }
  if (index < 0) for (let i = 0; i < chords.length && upcoming.length < 3; i++) { const n = display(chords[i].chord); if (chords[i].t0 > time && n !== last && n !== 'N') { upcoming.push({ name: n, t0: chords[i].t0 }); last = n } }
  const next = upcoming[0]
  const wait = next ? Math.max(0, next.t0 - time) : 0
  const tab = (on: boolean) => `h-7 flex-1 rounded-r3 text-[11px] font-semibold ${on ? 'bg-gold text-n1' : 'text-n11 hover:bg-n4'}`
  // posição arrastável (lembrada entre aberturas); sem posição salva, fica no canto direito
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const p = JSON.parse(localStorage.getItem('josue.liveChord.pos') || 'null'); return p && typeof p.x === 'number' ? p : null } catch { return null }
  })
  const clamp = (x: number, y: number) => {
    const el = box.current, w = el?.offsetWidth ?? 260, h = el?.offsetHeight ?? 400
    // o canto de cima sempre fica visível, mesmo em janela menor que o painel
    return { x: Math.max(4, Math.min(x, window.innerWidth - w - 4)), y: Math.max(4, Math.min(y, window.innerHeight - h - 4)) }
  }
  useEffect(() => {
    if (!pos) return
    const fit = () => setPos((p) => (p ? clamp(p.x, p.y) : p))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos === null])
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const r = box.current!.getBoundingClientRect()
    const dx = e.clientX - r.left, dy = e.clientY - r.top
    let latest = { x: r.left, y: r.top }
    const move = (ev: PointerEvent) => { latest = clamp(ev.clientX - dx, ev.clientY - dy); setPos(latest) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      try { localStorage.setItem('josue.liveChord.pos', JSON.stringify(latest)) } catch { /* sem armazenamento */ }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    e.preventDefault()
  }
  const center = () => {
    const el = box.current
    const p = clamp((window.innerWidth - (el?.offsetWidth ?? 260)) / 2, (window.innerHeight - (el?.offsetHeight ?? 400)) / 2)
    setPos(p)
    try { localStorage.setItem('josue.liveChord.pos', JSON.stringify(p)) } catch { /* */ }
  }
  return (
    <div ref={box} role="dialog" aria-label="Acorde atual" style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`splash-in no-scrollbar fixed z-40 max-h-[calc(100dvh-8px)] w-[min(400px,calc(100vw-16px))] overflow-y-auto rounded-[18px] border-2 border-gold/70 bg-n1/90 p-3 shadow-[0_12px_50px_#000c,0_0_30px_#e8b43733] backdrop-blur-md sm:w-[440px] ${pos ? '' : 'right-3 top-[150px] md:right-6'}`}>
      <div onPointerDown={startDrag} onDoubleClick={center} title="Arraste para mudar de lugar · dois cliques centraliza" className="-mx-1 -mt-1 flex cursor-grab touch-none select-none items-center justify-between rounded-r4 px-1 py-1 active:cursor-grabbing hover:bg-n3/50">
        <p className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-n11">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-n8"><circle cx="8" cy="6" r="2" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="18" r="2" /><circle cx="16" cy="18" r="2" /></svg>
          Acorde atual
        </p>
        <button onClick={onClose} aria-label="Fechar" className="grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4 hover:text-n12"><IClose size={16} /></button>
      </div>
      <div className="mt-2 flex gap-1 rounded-r4 bg-n2 p-1">
        <button className={tab(instrument === 'violao')} onClick={() => setInstrument('violao')}>Violão</button>
        <button className={tab(instrument === 'ukulele')} onClick={() => setInstrument('ukulele')}>Ukulele</button>
        <button className={tab(instrument === 'teclado')} onClick={() => setInstrument('teclado')}>Teclado</button>
      </div>
      {/* agora (grande, à esquerda) · próximos (à direita) */}
      <div className="mt-3 grid grid-cols-[1fr_150px] gap-3 sm:grid-cols-[1fr_170px]">
        <div>
          <p className="mb-1 text-caption text-n11">Agora</p>
          <div key={now + instrument} className="splash-in [&_figcaption]:text-[26px] [&_figure]:h-[calc(100%-0px)] [&_figure]:w-full [&_figure]:justify-center [&_figure]:py-2 [&_svg]:h-auto [&_svg]:w-[150px]">
            {now && now !== 'N' ? <ChordDiagram name={now} instrument={instrument} active /> : <div className="grid h-[210px] w-full place-items-center rounded-r4 border border-n3 bg-n2 text-sm2 text-n10">{index < 0 ? 'Aperte play' : 'Sem acorde'}</div>}
            {sounding && index >= 0 && now && now !== 'N' && sounding(chords[index].chord) !== now && (
              <p className="mt-1.5 text-center text-caption text-n10">desenho com capo · soa como <b className="font-mono text-[14px] text-gold">{sounding(chords[index].chord)}</b></p>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-1 flex items-baseline justify-between text-caption text-n11"><span>Próximos</span>{next && <span className="font-mono text-n10">em {wait.toFixed(1)} s</span>}</div>
          {next ? (
            <>
              <div className="grid grid-cols-2 gap-1.5 [&_figcaption]:text-[13px] [&_figure]:px-1 [&_svg]:h-auto [&_svg]:w-full">
                {upcoming.slice(0, 2).map((u, i) => <div key={i + u.name} className={i === 0 ? '' : 'opacity-70'}><ChordDiagram name={u.name} instrument={instrument} /></div>)}
              </div>
              {upcoming[2] && (
                <p className="mt-2 text-caption text-n10">depois: <span className="rounded-r3 bg-n3 px-2 py-0.5 font-mono text-[13px] text-n11">{upcoming[2].name}</span></p>
              )}
            </>
          ) : <p className="text-caption text-n9">Fim da música</p>}
        </div>
      </div>
    </div>
  )
}
