// Tela de estudo de uma tablatura importada do Guitar Pro: todas as faixas do arquivo
// (guitarra, baixo, bateria, teclado…), som de cada instrumento, mixer, velocidade e metrônomo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as alphaTab from '@coderline/alphatab'
import { getAudio, touchSong } from '../lib/db'
import { formatTime } from '../lib/audio'
import { KIND_LABEL, trackKind } from '../lib/gp'
import { midiToNote } from '../lib/tuner'
import { ensureMusicFont, exportTabPdf } from '../lib/tabPdf'
import { navigate } from '../App'
import type { GpTrackKind, Song } from '../lib/types'
import TunerDialog from '../components/TunerDialog'
import ShortcutsHelp, { GP_KEYS, typing } from '../components/ShortcutsHelp'
import { LiveChord } from './SongPage'
import type { Instrument } from '../lib/diagrams'
import { IArrowLeft, IClose, IDownload, IPause, IPlay, IStop, ITuner } from '../components/Icons'

type Mix = { mute: boolean; solo: boolean; vol: number }
const KIND_ICON: Record<GpTrackKind, string> = { violao: '🎸', guitarra: '🎸', baixo: '🎸', bateria: '🥁', teclado: '🎹', voz: '🎤', cordas: '🎻', sopro: '🎷', outro: '🎵' }
const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25]

function safeName(s: string) { return (s || 'tablatura').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'tablatura' }

export default function GpPage({ song }: { song: Song }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [score, setScore] = useState<alphaTab.model.Score | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [sel, setSel] = useState(-1)
  const [mix, setMix] = useState<Mix[]>([])
  const [playerReady, setPlayerReady] = useState(false)
  const [sf, setSf] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState({ cur: 0, end: 0, tick: 0 })
  const [speed, setSpeed] = useState(1)
  const [metro, setMetro] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [notation, setNotation] = useState<'tab' | 'both'>('tab')
  const [mixerOpen, setMixerOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [tunerOpen, setTunerOpen] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [liveOpen, setLiveOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // "tocadas recentemente" na biblioteca
  useEffect(() => { void touchSong(song.id, { lastOpenedAt: Date.now() }) }, [song.id])
  const [diagInst, setDiagInst] = useState<Instrument>('violao')

  // arquivo guardado
  useEffect(() => {
    let alive = true
    void getAudio(song.id).then(async (b) => {
      if (!alive) return
      if (!b) { setStatus('error'); setErrMsg('O arquivo desta tablatura não foi encontrado neste navegador.'); return }
      const data = new Uint8Array(await b.arrayBuffer())
      await ensureMusicFont()
      if (alive) setBytes(data)
    })
    return () => { alive = false }
  }, [song.id])

  const firstTrack = useMemo(() => {
    const t = song.gp?.tracks ?? []
    const i = t.findIndex((x) => x.kind === 'guitarra' || x.kind === 'violao')
    return i >= 0 ? i : Math.max(0, t.findIndex((x) => x.kind !== 'bateria'))
  }, [song.gp])

  // alphaTab: desenho + som
  useEffect(() => {
    if (!bytes || !hostRef.current || !scrollRef.current) return
    const api = new alphaTab.AlphaTabApi(hostRef.current, {
      core: { fontDirectory: new URL('./font/', document.baseURI).href, useWorkers: false },
      display: {
        layoutMode: 'page', scale: 1,
        resources: {
          staffLineColor: '#34497a', barSeparatorColor: '#46598a', barNumberColor: '#8090b3',
          mainGlyphColor: '#f3e6c8', secondaryGlyphColor: '#c4b48faa', scoreInfoColor: '#f3e6c8',
        },
      },
      notation: { elements: { scoreTitle: false, scoreSubTitle: false, scoreArtist: false, scoreWordsAndMusic: false, guitarTuning: true, chordDiagrams: false } },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        outputMode: alphaTab.PlayerOutputMode.WebAudioScriptProcessor,
        soundFont: new URL('./soundfont/sonivox.sf2', document.baseURI).href,
        enableCursor: true, enableAnimatedBeatCursor: true, enableUserInteraction: true,
        scrollElement: scrollRef.current, scrollOffsetY: -40,
      },
    } as unknown as alphaTab.json.SettingsJson)
    apiRef.current = api
    api.scoreLoaded.on((s) => {
      setScore(s)
      setMix(s.tracks.map(() => ({ mute: false, solo: false, vol: 1 })))
      setSel(firstTrack)
    })
    api.renderStarted.on(() => setStatus('loading'))
    api.renderFinished.on(() => setStatus('ready'))
    api.error.on((e) => { console.error(e); setStatus('error'); setErrMsg('Não foi possível desenhar esta tablatura.') })
    api.soundFontLoad.on((e) => setSf(e.total ? e.loaded / e.total : 0))
    api.playerReady.on(() => setPlayerReady(true))
    api.playerStateChanged.on((e) => setPlaying(Number(e.state) === 1))
    let last = 0
    // trecho escolhido arrastando o mouse sobre a tablatura vira o loop A-B
    api.playbackRangeChanged.on((e) => {
      const r = e.playbackRange
      if (r) { setLoop({ a: r.startTick, b: r.endTick }); api.isLooping = true; setLooping(true) }
    })
    api.playerPositionChanged.on((e) => {
      // treino progressivo: o loop voltou para o início do trecho -> +10% de velocidade
      if (progRef.current && e.currentTick < tickRef.current.cur - 960) setSpeed((v) => Math.min(1, Math.round((v + 0.1) * 10) / 10))
      tickRef.current = { cur: e.currentTick, end: e.endTick, endTime: e.endTime }
      const now = performance.now()
      if (now - last < 120 && e.currentTime < e.endTime) return
      last = now
      setPos({ cur: e.currentTime, end: e.endTime, tick: e.currentTick })
    })
    api.load(bytes, [firstTrack])
    return () => { try { api.destroy() } catch { /* ignore */ } apiRef.current = null }
  }, [bytes, firstTrack])

  // faixa mostrada + partitura/tab
  useEffect(() => {
    const api = apiRef.current
    if (!api || !score || sel < 0 || !score.tracks[sel]) return
    const t = score.tracks[sel]
    for (const st of t.staves) {
      if (st.isPercussion || !st.isStringed) { st.showStandardNotation = true; st.showTablature = st.isStringed }
      else { st.showTablature = true; st.showStandardNotation = notation === 'both' }
    }
    api.renderTracks([t])
  }, [score, sel, notation])

  // controles do player
  useEffect(() => { if (apiRef.current) apiRef.current.playbackSpeed = speed }, [speed, playerReady])
  useEffect(() => { if (apiRef.current) apiRef.current.metronomeVolume = metro ? 1 : 0 }, [metro, playerReady])
  useEffect(() => { if (apiRef.current) apiRef.current.countInVolume = countIn ? 1 : 0 }, [countIn, playerReady])

  const setTrackMix = (i: number, patch: Partial<Mix>) => {
    const api = apiRef.current
    if (!api || !score) return
    const next = mix.map((m, k) => (k === i ? { ...m, ...patch } : m))
    setMix(next)
    const t = [score.tracks[i]]
    if (patch.mute !== undefined) api.changeTrackMute(t, patch.mute)
    if (patch.solo !== undefined) api.changeTrackSolo(t, patch.solo)
    if (patch.vol !== undefined) api.changeTrackVolume(t, patch.vol)
  }

  const playPause = useCallback(() => { const a = apiRef.current; if (a && playerReady) a.playPause() }, [playerReady])
  const stop = () => { apiRef.current?.stop() }

  // loop A-B (em ticks do MIDI; o tempo mostrado é aproximado pela proporção da música)
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null })
  const [looping, setLooping] = useState(false)
  const [progressive, setProgressive] = useState(false)
  const progRef = useRef(false)
  progRef.current = progressive && looping
  const tickRef = useRef({ cur: 0, end: 0, endTime: 0 })
  const tickToMs = (t: number) => (tickRef.current.end ? (t / tickRef.current.end) * tickRef.current.endTime : 0)
  const applyLoop = (a: number | null, b: number | null) => {
    const api = apiRef.current
    if (!api) return
    if (a !== null && b !== null && b > a) {
      const r = new alphaTab.synth.PlaybackRange()
      r.startTick = a; r.endTick = b
      api.playbackRange = r
      api.isLooping = true
      setLooping(true)
      if (tickRef.current.cur < a || tickRef.current.cur > b) api.tickPosition = a
    }
  }
  const markA = () => { const a = tickRef.current.cur; const b = loop.b !== null && loop.b > a ? loop.b : null; setLoop({ a, b }); applyLoop(a, b) }
  const markB = () => {
    const b = tickRef.current.cur
    if (loop.a === null || b <= loop.a) { setLoop({ a: loop.a, b: null }); return }
    setLoop({ a: loop.a, b }); applyLoop(loop.a, b)
  }
  const toggleLoop = () => {
    const api = apiRef.current
    if (!api || loop.a === null || loop.b === null) return
    api.isLooping = !looping
    setLooping(!looping)
  }
  const clearLoop = () => {
    const api = apiRef.current
    if (api) { api.playbackRange = null; api.isLooping = false }
    setLoop({ a: null, b: null }); setLooping(false)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Space') { e.preventDefault(); playPause(); return }
      if (e.key === '?') { setHelpOpen((v) => !v); return }
      const key = e.key.toLowerCase()
      if (key === 'a' && playerReady) markA()
      else if (key === 'b' && playerReady) markB()
      else if (key === 'c') setLiveOpen((v) => !v)
      else if (key === 't') setTunerOpen((v) => !v)
      else if (key === 'm') setMetro((v) => !v)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const tracks = score?.tracks ?? []
  const cur = tracks[sel]
  const curKind = cur ? trackKind(cur) : 'outro'
  const meta = song.meta
  // acordes escritos no arquivo (da faixa escolhida; se ela não tiver, da primeira faixa que tiver)
  const gpChords = useMemo(() => {
    if (!score) return [] as { tick: number; name: string }[]
    const pick = (t: alphaTab.model.Track) => {
      const out: { tick: number; name: string }[] = []
      for (const st of t.staves) for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) {
        const name = b.hasChord ? b.chord?.name?.trim() : ''
        if (name) out.push({ tick: b.absolutePlaybackStart, name })
      }
      return out.sort((x, y) => x.tick - y.tick)
    }
    let c = cur ? pick(cur) : []
    if (!c.length) for (const t of score.tracks) { c = pick(t); if (c.length) break }
    return c
  }, [score, cur])
  // no formato do painel "Acorde atual" (tempo em segundos, aproximado pela proporção da música)
  const liveChords = useMemo(() => gpChords.map((c, i) => ({
    t0: tickToMs(c.tick) / 1000, t1: tickToMs(gpChords[i + 1]?.tick ?? tickRef.current.end) / 1000, chord: c.name,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [gpChords, pos.end])
  let chordIdx = -1
  for (let i = 0; i < gpChords.length; i++) if (gpChords[i].tick <= pos.tick + 10) chordIdx = i

  // afinação da faixa (o alphaTab guarda da corda mais aguda para a mais grave)
  const tunerPreset = useMemo(() => {
    const st = cur?.staves.find((x) => x.isStringed && !x.isPercussion && x.tuning?.length)
    if (!cur || !st) return undefined
    return { label: cur.name || KIND_LABEL[curKind], notes: [...st.tuning].reverse().map(midiToNote) }
  }, [cur, curKind])

  const exportPdf = async () => {
    setExportOpen(false)
    if (!bytes || sel < 0 || pdfBusy) return
    setPdfBusy(true)
    try {
      const name = cur?.name || KIND_LABEL[curKind]
      await exportTabPdf({
        bytes, tracks: [sel], title: song.title, subtitle: `Tablatura · ${name}`,
        chips: [KIND_LABEL[curKind], meta.key ? `Tom ${meta.key}` : '', meta.bpm ? `${meta.bpm} BPM` : '', meta.timeSig ? `Compasso ${meta.timeSig}` : ''].filter(Boolean),
        fileName: `${safeName(song.title)} - ${safeName(name)}.pdf`,
      })
    } catch (e) {
      alert('Não foi possível gerar o PDF: ' + String((e as Error)?.message ?? e))
    } finally { setPdfBusy(false) }
  }
  const downloadOriginal = async () => {
    setExportOpen(false)
    const b = await getAudio(song.id)
    if (!b) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b); a.download = song.fileName
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const chip = 'whitespace-nowrap rounded-r3 bg-n2/80 px-2 py-0.5 text-caption text-n11'
  const pill = (on: boolean) => `h-9 whitespace-nowrap rounded-r4 px-3 text-caption font-semibold transition ${on ? 'gold-btn text-n1' : 'bg-n3/80 text-n12 hover:bg-n4'}`
  const action = (on = false) => `flex h-8 items-center gap-1.5 whitespace-nowrap rounded-r4 px-2.5 text-caption font-semibold ${on ? 'bg-gold text-n1' : 'bg-n3 text-n12 hover:bg-n4'}`

  return (
    <div className="flex h-dvh flex-col bg-bg bg-cover bg-top" style={{ backgroundImage: 'url(./img/fundo-musica.webp)' }}>
      {/* cabeçalho */}
      <header className="z-30 shrink-0 border-b border-gold/20 bg-n1/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-3 py-3 md:px-6">
          <button onClick={() => navigate('/')} className="flex h-9 items-center gap-1 rounded-r4 pl-1 pr-3 text-sm2 text-n11 hover:bg-n3 hover:text-n12" aria-label="Voltar para a biblioteca">
            <IArrowLeft size={20} /> <span className="hidden sm:inline">Biblioteca</span>
          </button>
          <img src="./img/josue-96.png" alt="" width={56} height={56} className="hidden h-14 w-14 shrink-0 rounded-r5 ring-2 ring-gold/70 sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate px-1 text-[17px] font-medium text-n12 md:text-[20px]">{song.title}</h1>
            <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto px-1">
              <span className={chip + ' text-gold'}>Guitar Pro · {song.gp?.format}</span>
              {meta.bpm > 0 && <span className={chip}><b className="font-semibold text-n12">{meta.bpm}</b> BPM</span>}
              {meta.key && <span className={chip}>Tom <b className="font-semibold text-gold">{meta.key}</b></span>}
              {meta.timeSig && <span className={chip}>Compasso <b className="font-semibold text-n12">{meta.timeSig}</b></span>}
              <span className={chip}>{tracks.length || song.gp?.tracks.length} faixas</span>
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <button onClick={() => setTunerOpen(true)} className={action()}><ITuner size={16} className="text-gold" /> Afinador</button>
          </div>
          <div className="relative">
            <button onClick={() => setExportOpen((v) => !v)} disabled={pdfBusy} aria-haspopup="menu" aria-expanded={exportOpen}
              className="flex h-10 items-center gap-2 rounded-r5 border-2 border-gold/80 bg-n1/60 px-4 text-sm2 font-semibold text-n12 hover:bg-n2/80 disabled:opacity-60">
              <IDownload size={18} /> <span className="hidden sm:inline">{pdfBusy ? 'Gerando PDF…' : 'Exportar'}</span>
            </button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 top-12 z-40 w-[260px] overflow-hidden rounded-r5 border border-n5 bg-n2 shadow-2xl shadow-black/60">
                <button role="menuitem" onClick={() => void exportPdf()} className="block w-full px-4 py-2.5 text-left hover:bg-n3">
                  <p className="text-sm2 font-medium text-n12">PDF da faixa</p><p className="text-caption text-n10">{cur ? `${cur.name} — a música inteira` : ''}</p>
                </button>
                <button role="menuitem" onClick={() => void downloadOriginal()} className="block w-full px-4 py-2.5 text-left hover:bg-n3">
                  <p className="text-sm2 font-medium text-n12">Arquivo original</p><p className="text-caption text-n10">{song.fileName}</p>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* faixas + opções */}
        <div className="no-scrollbar mx-auto flex max-w-[1440px] items-center gap-1.5 overflow-x-auto px-3 pb-3 md:px-6">
          <div className="flex shrink-0 gap-1.5" role="tablist" aria-label="Faixas">
            {tracks.map((t, i) => (
              <button key={i} role="tab" aria-selected={sel === i} onClick={() => setSel(i)} title={`${KIND_LABEL[trackKind(t)]}: ${t.name}`} className={pill(sel === i)}>
                <span className="mr-1" aria-hidden>{KIND_ICON[trackKind(t)]}</span>{t.name || KIND_LABEL[trackKind(t)]}
              </button>
            ))}
          </div>
          <span className="mx-1 h-6 w-px shrink-0 bg-n4" />
          {cur && !cur.staves.some((s) => s.isPercussion) && cur.staves.some((s) => s.isStringed) && (
            <div className="flex shrink-0 gap-1.5" role="group" aria-label="Notação">
              <button className={pill(notation === 'tab')} onClick={() => setNotation('tab')}>Só tablatura</button>
              <button className={pill(notation === 'both')} onClick={() => setNotation('both')}>Partitura + tab</button>
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {gpChords.length > 0 && <button onClick={() => setLiveOpen((v) => !v)} aria-pressed={liveOpen} title="Mostra o acorde que está tocando agora" className={action(liveOpen)}>Acorde atual</button>}
            <button onClick={() => setMixerOpen((v) => !v)} aria-pressed={mixerOpen} className={action(mixerOpen)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
              Mixer
            </button>
            <button onClick={() => setHelpOpen(true)} title="Atalhos de teclado (?)" aria-label="Atalhos de teclado" className={action()}>⌨</button>
            <button onClick={() => setTunerOpen(true)} className={action() + ' md:hidden'}><ITuner size={16} className="text-gold" /> Afinador</button>
          </div>
        </div>
      </header>

      {/* tablatura */}
      <div className="relative mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 px-3 pt-3 md:px-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border-2 border-gold/60 bg-n1/55 backdrop-blur-sm">
          <div ref={scrollRef} className="tabview relative min-h-0 flex-1 overflow-y-auto px-2 pb-24 pt-2 md:px-6">
            <div ref={hostRef} />
            {status === 'loading' && !score && <p className="py-16 text-center text-sm2 text-n10">Abrindo a tablatura…</p>}
            {status === 'error' && <p className="py-16 text-center text-sm2 text-amber">{errMsg}</p>}
          </div>
        </div>

        {/* mixer */}
        {mixerOpen && score && (
          <aside className="splash-in absolute right-5 top-5 z-30 max-h-[calc(100%-40px)] w-[320px] overflow-y-auto rounded-[18px] border-2 border-gold/70 bg-n1/95 p-3 shadow-[0_12px_50px_#000c] backdrop-blur-md md:right-9" aria-label="Mixer">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-caption font-semibold uppercase tracking-wider text-n11">Mixer</p>
              <button onClick={() => setMixerOpen(false)} aria-label="Fechar" className="grid h-7 w-7 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={16} /></button>
            </div>
            <div className="flex flex-col gap-1.5">
              {tracks.map((t, i) => {
                const m = mix[i] ?? { mute: false, solo: false, vol: 1 }
                return (
                  <div key={i} className={`rounded-r4 border px-2.5 py-2 ${sel === i ? 'border-gold/60 bg-gold/5' : 'border-n4 bg-n2/70'}`}>
                    <div className="flex items-center gap-2">
                      <span aria-hidden>{KIND_ICON[trackKind(t)]}</span>
                      <button onClick={() => setSel(i)} className="min-w-0 flex-1 truncate text-left text-sm2 text-n12 hover:text-gold" title="Mostrar esta faixa">{t.name || KIND_LABEL[trackKind(t)]}</button>
                      <button onClick={() => setTrackMix(i, { mute: !m.mute })} aria-pressed={m.mute} title="Mudo" className={`h-6 w-7 rounded-r3 text-[11px] font-bold ${m.mute ? 'bg-error text-white' : 'bg-n4 text-n11 hover:bg-n5'}`}>M</button>
                      <button onClick={() => setTrackMix(i, { solo: !m.solo })} aria-pressed={m.solo} title="Solo (só esta)" className={`h-6 w-7 rounded-r3 text-[11px] font-bold ${m.solo ? 'bg-gold text-n1' : 'bg-n4 text-n11 hover:bg-n5'}`}>S</button>
                    </div>
                    <input type="range" min={0} max={2} step={0.05} value={m.vol} onChange={(e) => setTrackMix(i, { vol: Number(e.target.value) })} aria-label={`Volume de ${t.name}`} className="mt-1.5 w-full accent-[#e8b437]" />
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-n9">M = mudo · S = solo. Dica: deixe sua faixa no mudo e toque junto com o resto da banda.</p>
          </aside>
        )}
      </div>

      {/* player */}
      <footer className="z-30 shrink-0 border-t border-gold/20 bg-n1/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-3 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <span className="w-12 font-mono text-caption text-n10">{formatTime(pos.cur / 1000)}</span>
            <input type="range" className="seek flex-1" min={0} max={Math.max(1, pos.end)} step={100} value={pos.cur}
              style={{ background: loop.a !== null && loop.b !== null && tickRef.current.end
                ? `linear-gradient(90deg, #2e4473 ${(loop.a / tickRef.current.end) * 100}%, #e8b43788 ${(loop.a / tickRef.current.end) * 100}%, #e8b43788 ${(loop.b / tickRef.current.end) * 100}%, #2e4473 ${(loop.b / tickRef.current.end) * 100}%)`
                : `linear-gradient(90deg, #e8b437 ${(pos.cur / Math.max(1, pos.end)) * 100}%, #2e4473 0)` }}
              onChange={(e) => { const v = Number(e.target.value); setPos((p) => ({ ...p, cur: v })); if (apiRef.current) apiRef.current.timePosition = v }}
              aria-label="Posição" disabled={!playerReady} />
            <span className="w-12 text-right font-mono text-caption text-n10">{formatTime((pos.end || meta.duration * 1000) / 1000)}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-caption text-n10">Velocidade
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-8 rounded-r4 border border-n5 bg-n2 px-1.5 font-mono text-caption text-n12 outline-none">
                {SPEEDS.map((s) => <option key={s} value={s}>{String(s).replace(".", ",")}x</option>)}
              </select>
            </label>
            <div className="mx-auto flex items-center gap-3">
              <button onClick={stop} disabled={!playerReady} aria-label="Parar" className="grid h-10 w-10 place-items-center rounded-full text-n11 hover:bg-n3 hover:text-n12 disabled:opacity-40"><IStop size={18} /></button>
              <button onClick={playPause} disabled={!playerReady} aria-label={playing ? 'Pausar' : 'Tocar'} className="gold-btn grid h-14 w-14 place-items-center rounded-full text-n1 disabled:opacity-50">
                {playing ? <IPause size={24} /> : <IPlay size={24} />}
              </button>
              <span className="w-10" />
            </div>
            <div className="flex items-center gap-1 rounded-r4 bg-n2/80 p-0.5" role="group" aria-label="Repetir trecho (loop A-B)" title="Marque o início (A) e o fim (B) do trecho com a música tocando — ou arraste o mouse sobre os compassos">
              <button onClick={markA} disabled={!playerReady} className={`h-7 rounded-r3 px-2 font-mono text-caption font-semibold disabled:opacity-40 ${loop.a !== null ? 'bg-n4 text-gold' : 'text-n11 hover:bg-n4'}`}>
                A{loop.a !== null && tickRef.current.end ? ` ${formatTime(tickToMs(loop.a) / 1000)}` : ''}
              </button>
              <button onClick={markB} disabled={!playerReady || loop.a === null} className={`h-7 rounded-r3 px-2 font-mono text-caption font-semibold disabled:opacity-40 ${loop.b !== null ? 'bg-n4 text-gold' : 'text-n11 hover:bg-n4'}`}>
                B{loop.b !== null && tickRef.current.end ? ` ${formatTime(tickToMs(loop.b) / 1000)}` : ''}
              </button>
              <button onClick={toggleLoop} disabled={loop.a === null || loop.b === null} aria-pressed={looping} title="Repetir o trecho" className={`h-7 rounded-r3 px-2 text-caption font-semibold disabled:opacity-40 ${looping ? 'bg-gold text-n1' : 'text-n11 hover:bg-n4'}`}>🔁 Repetir</button>
              {loop.a !== null && loop.b !== null && <button onClick={() => { const on = !progressive; setProgressive(on); if (on && speed >= 1) setSpeed(0.7) }} aria-pressed={progressive} title="A cada repetição, +10% de velocidade até 100%" className={`h-7 rounded-r3 px-2 text-caption font-semibold ${progressive ? 'bg-gold text-n1' : 'text-n11 hover:bg-n4'}`}>Progressivo{progressive ? ` ${Math.round(speed * 100)}%` : ''}</button>}
              {(loop.a !== null || loop.b !== null) && <button onClick={clearLoop} aria-label="Limpar trecho" className="grid h-7 w-7 place-items-center rounded-r3 text-n10 hover:bg-n4 hover:text-n12"><IClose size={14} /></button>}
            </div>
            <button onClick={() => setCountIn((v) => !v)} aria-pressed={countIn} title="Contagem antes de começar" className={`h-8 rounded-r4 px-2 text-caption font-semibold ${countIn ? 'text-gold' : 'text-n10 hover:text-n12'}`}>Contagem</button>
            <button onClick={() => setMetro((v) => !v)} aria-pressed={metro} className={`h-8 rounded-r4 px-2 text-caption font-semibold ${metro ? 'text-gold' : 'text-n10 hover:text-n12'}`}>Metrônomo</button>
          </div>
          {!playerReady && <p className="text-center text-[11px] text-n9">Carregando os sons dos instrumentos… {Math.round(sf * 100)}%</p>}
        </div>
      </footer>

      {liveOpen && gpChords.length > 0 && <LiveChord chords={liveChords} index={chordIdx} time={pos.cur / 1000} display={(c) => c} instrument={diagInst} setInstrument={setDiagInst} onClose={() => setLiveOpen(false)} />}
      {helpOpen && <ShortcutsHelp keys={GP_KEYS} onClose={() => setHelpOpen(false)} />}
      {tunerOpen && <TunerDialog preset={tunerPreset} onClose={() => setTunerOpen(false)} />}
    </div>
  )
}
