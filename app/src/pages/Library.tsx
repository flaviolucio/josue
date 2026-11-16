import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteSong, listSetlists, listSongs, subscribe, touchSong } from '../lib/db'
import { ACCEPT, addFile, resumeQueue, retry } from '../lib/pipeline'
import { exportBackup, formatBytes, importBackup } from '../lib/backup'
import { GP_ACCEPT, importGp, isGpFile } from '../lib/gp'
import { formatTime } from '../lib/audio'
import { chordServerAlive, isYoutubeUrl, youtubeToFile } from '../lib/api'
import { STEPS, type Setlist, type Song } from '../lib/types'
import { navigate } from '../App'
import { IChevron, ILink, ISearch, ITrash, IUpload, IRetry, ITab, ITuner, VERSE, VERSE_REF } from '../components/Icons'
import SettingsCard from '../components/SettingsCard'
import TunerDialog from '../components/TunerDialog'
import AboutDialog, { shouldShowNews } from '../components/AboutDialog'
import { CREATOR, YEAR } from '../components/Splash'
import { Cover } from '../components/Cover'
import PrivacyNotice from '../components/PrivacyNotice'
import { loadSettings, saveSettings } from '../lib/settings'


function useSongs() {
  const [songs, setSongs] = useState<Song[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => listSongs().then((s) => alive && setSongs(s))
    load()
    const un = subscribe(load)
    return () => { alive = false; un() }
  }, [])
  return songs
}

export default function Library() {
  const songs = useSongs()
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const gpRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLInputElement>(null)
  const [bkBusy, setBkBusy] = useState('')
  const [bkMsg, setBkMsg] = useState('')
  async function doBackup() {
    setBkMsg(''); setBkBusy('Preparando o backup…')
    try {
      const r = await exportBackup(setBkBusy)
      setBkMsg(`Backup salvo na pasta de downloads: ${r.songs} músicas e ${r.setlists} repertórios (${formatBytes(r.bytes)}).`)
    } catch (e) { setBkMsg('Erro ao fazer o backup: ' + (e as Error).message) } finally { setBkBusy('') }
  }
  async function doRestore(f: File) {
    setBkMsg(''); setBkBusy('Lendo o backup…')
    try {
      const r = await importBackup(f, setBkBusy)
      setBkMsg(`Backup restaurado: ${r.added} músicas novas, ${r.updated} atualizadas, ${r.kept} já estavam iguais ou mais novas aqui${r.setlists ? `, ${r.setlists} repertórios` : ''}.`)
      void resumeQueue()
    } catch (e) { setBkMsg('Erro: ' + (e as Error).message) } finally { setBkBusy('') }
  }
  const settingsRef = useRef<HTMLDivElement>(null)
  const [settingsKey, setSettingsKey] = useState(0)
  const [tunerOpen, setTunerOpen] = useState(false)
  const [about, setAbout] = useState<null | 'sobre' | 'novidades'>(null)
  // depois de uma atualização, mostra as novidades uma vez (depois da tela de abertura)
  useEffect(() => { if (!shouldShowNews()) return; const t = setTimeout(() => setAbout('novidades'), 3200); return () => clearTimeout(t) }, [])
  const [showCfg, setShowCfg] = useState(false)
  const showSettings = () => { setShowCfg(true); setTimeout(() => settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }
  const useServer = () => { saveSettings({ ...loadSettings(), engine: 'server' }); setSettingsKey((k) => k + 1); setTimeout(showSettings, 50) }

  // filtros: tipo, andamento, tom, repertório e favoritas
  const [fKind, setFKind] = useState<'' | 'cifra' | 'gp'>('')
  const [fTempo, setFTempo] = useState<'' | 'lenta' | 'media' | 'rapida'>('')
  const [fKey, setFKey] = useState('')
  const [fSet, setFSet] = useState('')
  const [fFav, setFFav] = useState(false)
  const [setlists, setSetlists] = useState<Setlist[]>([])
  useEffect(() => { const load = () => void listSetlists().then(setSetlists); load(); return subscribe(load) }, [])
  const keys = useMemo(() => [...new Set((songs ?? []).map((s) => s.meta.key).filter(Boolean))].sort(), [songs])
  const anyFilter = !!(fKind || fTempo || fKey || fSet || fFav)
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    const inSet = fSet ? new Set(setlists.find((l) => l.id === fSet)?.items.map((i) => i.songId)) : null
    return (songs ?? []).filter((s) => {
      if (n && !(s.title.toLowerCase().includes(n) || s.meta.key.toLowerCase() === n)) return false
      if (fKind === 'gp' && !s.gp) return false
      if (fKind === 'cifra' && s.gp) return false
      const bpm = s.meta.bpm || 0
      if (fTempo === 'lenta' && !(bpm && bpm < 80)) return false
      if (fTempo === 'media' && !(bpm >= 80 && bpm <= 120)) return false
      if (fTempo === 'rapida' && !(bpm > 120)) return false
      if (fKey && s.meta.key !== fKey) return false
      if (inSet && !inSet.has(s.id)) return false
      if (fFav && !s.favorite) return false
      return true
    }).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite))
  }, [songs, q, fKind, fTempo, fKey, fSet, fFav, setlists])
  const recent = useMemo(() => (songs ?? []).filter((s) => s.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)).slice(0, 6), [songs])

  const [link, setLink] = useState('')
  const [ytBusy, setYtBusy] = useState<number | null>(null)
  async function onLink() {
    setError('')
    if (!isYoutubeUrl(link)) { setError('Cole um link de vídeo do YouTube (youtube.com/watch?v=… ou youtu.be/…).'); return }
    if (!(await chordServerAlive())) { setError('Para links do YouTube, abra o Josué pelo atalho (servidor local) e tente de novo.'); return }
    setYtBusy(0)
    try {
      const file = await youtubeToFile(link, setYtBusy)
      setLink('')
      await onFiles([file])
    } catch (e) { setError((e as Error).message) }
    finally { setYtBusy(null) }
  }

  async function onFiles(files: FileList | File[] | null) {
    // copia já: o campo de arquivo é limpo logo depois e a lista original fica vazia
    const list = files ? Array.from(files) : []
    if (!list.length) return
    setError('')
    let firstId = ''
    for (const f of list) {
      try { const id = isGpFile(f) ? await importGp(f) : await addFile(f); firstId ||= id } catch (e) { setError((e as Error).message) }
    }
    if (firstId && list.length === 1) navigate(`/musica/${firstId}`)
  }

  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDragging(true) } }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragging(false); void onFiles(e.dataTransfer?.files ?? null) }
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])

  const pick = () => inputRef.current?.click()

  const library = (
    <section className="mt-10 w-full max-w-[1000px] rounded-[22px] border-2 border-gold/70 bg-n1/75 p-4 shadow-[0_0_40px_#e8b43722] backdrop-blur-md sm:p-6" aria-label="Biblioteca">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-[24px] font-semibold text-n12 sm:text-[28px]"><span className="text-gold">♫</span> Suas músicas</h2>
        <span className="text-sm2 text-n11">{songs?.length ?? 0} {songs?.length === 1 ? 'música' : 'músicas'}</span>
      </div>
      <label className="mb-4 flex h-12 items-center gap-3 rounded-r5 border border-gold/70 bg-n2/60 px-4 text-n11 focus-within:border-gold">
        <ISearch size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título ou tom" className="w-full bg-transparent text-body text-n12 outline-none placeholder:text-n10" />
      </label>
      <div className="no-scrollbar -mt-1 mb-4 flex flex-wrap items-center gap-1.5 text-caption">
        <button onClick={() => setFFav((v) => !v)} aria-pressed={fFav} className={`h-8 rounded-full border px-3 font-semibold ${fFav ? 'border-gold bg-gold text-n1' : 'border-n6 text-n11 hover:border-gold/60'}`}>★ Favoritas</button>
        <select value={fKind} onChange={(e) => setFKind(e.target.value as typeof fKind)} aria-label="Tipo" className={filterSel(!!fKind)}>
          <option value="">Todos os tipos</option><option value="cifra">Cifras (áudio)</option><option value="gp">Guitar Pro</option>
        </select>
        <select value={fTempo} onChange={(e) => setFTempo(e.target.value as typeof fTempo)} aria-label="Andamento" className={filterSel(!!fTempo)}>
          <option value="">Qualquer andamento</option><option value="lenta">Lentas (até 80 BPM)</option><option value="media">Médias (80–120)</option><option value="rapida">Rápidas (acima de 120)</option>
        </select>
        <select value={fKey} onChange={(e) => setFKey(e.target.value)} aria-label="Tom" className={filterSel(!!fKey)}>
          <option value="">Qualquer tom</option>{keys.map((k) => <option key={k} value={k}>Tom {k}</option>)}
        </select>
        {setlists.length > 0 && (
          <select value={fSet} onChange={(e) => setFSet(e.target.value)} aria-label="Repertório" className={filterSel(!!fSet)}>
            <option value="">Todos os repertórios</option>{setlists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {anyFilter && <button onClick={() => { setFKind(''); setFTempo(''); setFKey(''); setFSet(''); setFFav(false) }} className="h-8 px-2 text-gold hover:underline">Limpar filtros</button>}
      </div>
      {recent.length > 0 && !q && !anyFilter && (
        <div className="mb-4">
          <p className="mb-1.5 text-caption font-semibold uppercase tracking-wider text-n10">Tocadas recentemente</p>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {recent.map((s) => (
              <button key={s.id} onClick={() => navigate(`/musica/${s.id}`)} className="flex shrink-0 items-center gap-2 rounded-r4 border border-n5 bg-n2/70 py-1.5 pl-1.5 pr-3 text-left hover:border-gold/60">
                <Cover hue={s.hue} size={32} />
                <span className="max-w-[170px] truncate text-sm2 text-n12">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="flex flex-col gap-2.5">
        {songs === null && <li className="h-[80px] rounded-r5 bg-n2 pulse-soft" />}
        {songs && filtered.length === 0 && (
          <li className="rounded-r5 border border-dashed border-n6 px-4 py-8 text-center text-sm2 text-n11">{songs.length ? 'Nada encontrado.' : 'Nenhuma música ainda. Envie um áudio para começar.'}</li>
        )}
        {filtered.map((s) => <SongRow key={s.id} song={s} />)}
      </ul>
    </section>
  )

  return (
    <div className="no-scrollbar relative h-dvh overflow-y-auto overflow-x-hidden bg-bg bg-fixed bg-cover bg-top" style={{ backgroundImage: 'url(./img/fundo-inicio.webp)' }}>
      <input ref={gpRef} type="file" accept={GP_ACCEPT} multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
      <input ref={inputRef} type="file" accept={ACCEPT + ',' + GP_ACCEPT} multiple className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />

      <div className="relative z-10 flex justify-end gap-2 px-3 pt-3 sm:absolute sm:right-6 sm:top-5 sm:p-0">
        <button onClick={() => setAbout('sobre')} aria-label="Sobre" title="Sobre o Josué e novidades" className="flex h-10 items-center gap-2 rounded-r5 border-2 border-gold/80 bg-n1/70 px-3 text-sm2 font-semibold text-n12 backdrop-blur transition hover:bg-n2/80"><span aria-hidden className="text-gold">ⓘ</span> <span className="hidden sm:inline">Sobre</span></button>
        <button onClick={() => navigate('/repertorio')} aria-label="Repertório" title="Repertório" className="flex h-10 items-center gap-2 rounded-r5 border-2 border-gold/80 bg-n1/70 px-3 text-sm2 font-semibold text-n12 backdrop-blur transition hover:bg-n2/80"><span aria-hidden className="text-gold">☰</span> <span className="hidden sm:inline">Repertório</span></button>
        <button onClick={() => setTunerOpen(true)} aria-label="Afinador" title="Afinador" className="flex h-10 items-center gap-2 rounded-r5 border-2 border-gold/80 bg-n1/70 px-3 text-sm2 font-semibold text-n12 backdrop-blur transition hover:bg-n2/80"><ITuner size={18} className="text-gold" /> <span className="hidden sm:inline">Afinador</span></button>
      </div>

      <main className="mx-auto flex w-full max-w-[1100px] flex-col items-center px-4 pb-10 pt-8 sm:px-6 lg:pt-12">
        {/* cabeçalho: ícone + nome + subtítulo */}
        <header className="flex flex-col items-center gap-4 sm:flex-row sm:gap-7">
          <img src="./img/josue.webp" alt="" width={220} height={220} className="h-[150px] w-[150px] rounded-[30px] shadow-[0_10px_50px_#e8b43755] ring-2 ring-gold/80 sm:h-[200px] sm:w-[200px]" />
          <div className="text-center sm:text-left">
            <h1 className="josue-title text-[64px] leading-none sm:text-[92px]" aria-label="Josué">Josué</h1>
            <div className="mx-auto mt-1 h-[3px] w-[85%] rounded-full bg-gradient-to-r from-transparent via-gold to-transparent sm:mx-0" />
            <p className="mt-3 text-[20px] font-medium text-n12 sm:text-[26px]">Transforme música em cifra</p>
          </div>
        </header>

        <figure className="mt-6 flex w-full max-w-[900px] items-center gap-4 text-center">
          <span className="hidden h-[2px] flex-1 rounded bg-gradient-to-r from-transparent to-gold sm:block" />
          <blockquote className="font-serif text-[17px] italic leading-snug text-n12 sm:text-[22px]">{VERSE} <span className="whitespace-nowrap not-italic text-gold">— {VERSE_REF}</span></blockquote>
          <span className="hidden h-[2px] flex-1 rounded bg-gradient-to-l from-transparent to-gold sm:block" />
        </figure>

        <div className="mt-6 grid w-full max-w-[850px] gap-4 sm:grid-cols-2">
          <button onClick={pick} className="gold-btn flex h-14 items-center justify-center gap-3 rounded-r6 text-[19px] font-bold text-n1">
            <IUpload size={24} /> Enviar áudio
          </button>
          {!showLink ? (
            <button onClick={() => setShowLink(true)} className="flex h-14 items-center justify-center gap-3 rounded-r6 border-2 border-gold/80 bg-n1/70 text-[19px] font-medium text-n12 backdrop-blur transition hover:bg-n2/80">
              <ILink size={22} /> Colar link do YouTube
            </button>
          ) : (
            <form className="rounded-r6 border-2 border-gold/80 bg-n1/80 p-3 backdrop-blur" onSubmit={(e) => { e.preventDefault(); void onLink() }}>
              <div className="flex gap-2">
                <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} disabled={ytBusy !== null} placeholder="https://youtube.com/…"
                  className="h-10 min-w-0 flex-1 rounded-r4 bg-n2 px-3 text-sm2 text-n12 outline-none placeholder:text-n9" />
                <button type="submit" disabled={ytBusy !== null || !link.trim()} className="h-10 shrink-0 rounded-r4 bg-gold px-3 text-sm2 font-semibold text-n1 disabled:opacity-40">Enviar</button>
              </div>
              {ytBusy !== null ? (
                <div className="mt-2">
                  <p className="text-caption text-n11">Baixando o áudio do vídeo… {Math.round(ytBusy * 100)}%</p>
                  <div className="mt-1 h-1 rounded bg-n4"><div className="h-1 rounded bg-gold transition-all" style={{ width: `${Math.max(3, ytBusy * 100)}%` }} /></div>
                </div>
              ) : (
                <p className="mt-2 text-caption leading-snug text-n11">O áudio é baixado pelo servidor local (o Josué precisa estar aberto pelo atalho). Use só com músicas que você tem direito de usar.</p>
              )}
            </form>
          )}
        </div>
        <button onClick={() => gpRef.current?.click()} className="mt-3 flex items-center gap-2 rounded-r5 px-3 py-1.5 text-sm2 text-n11 transition hover:bg-n1/60 hover:text-n12">
          <ITab size={18} className="text-gold" /> Importar tablatura do Guitar Pro <span className="text-caption text-n9">(.gp3, .gp4, .gp5, .gpx, .gp)</span>
        </button>
        {error && <p role="alert" className="mt-4 w-full max-w-[850px] rounded-r4 bg-error/15 px-3 py-2 text-sm2 text-error">{error}</p>}

        {library}

        <div className="mt-6 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-sm2">
          <span className="text-n11">Ainda sem música?</span>
          <button onClick={() => navigate('/musica/exemplo-manha')} className="text-gold hover:underline">Abrir o exemplo</button>
          <span className="text-n8">·</span>
          <button onClick={() => navigate('/repertorio')} className="text-gold hover:underline">Repertórios</button>
          <span className="text-n8">·</span>
          <button onClick={() => setShowCfg((v) => !v)} className="text-gold hover:underline">{showCfg ? 'Fechar configurações' : 'Configurações'}</button>
        </div>
        {showCfg && <div ref={settingsRef} className="mt-4 w-full max-w-[1000px]"><SettingsCard key={settingsKey} /></div>}

        {/* backup */}
        <section className="mt-8 w-full max-w-[850px] rounded-r6 border border-gold/30 bg-n1/60 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm2 font-semibold text-n12">Backup da biblioteca</p>
              <p className="text-caption leading-snug text-n10">Suas músicas ficam salvas só neste navegador. Guarde um backup (num pendrive, no OneDrive…) para não perder nada e para levar para outro computador.</p>
            </div>
            <button onClick={() => void doBackup()} disabled={!!bkBusy} className="h-9 rounded-r4 bg-gold px-4 text-sm2 font-semibold text-n1 disabled:opacity-50">Fazer backup</button>
            <button onClick={() => restoreRef.current?.click()} disabled={!!bkBusy} className="h-9 rounded-r4 border border-gold/60 px-4 text-sm2 font-semibold text-n12 hover:bg-n2 disabled:opacity-50">Restaurar backup</button>
            <input ref={restoreRef} type="file" accept=".josue" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doRestore(f) }} />
          </div>
          {(bkBusy || bkMsg) && <p role="status" className={`mt-2 text-caption ${bkBusy ? 'text-n11' : bkMsg.startsWith('Erro') ? 'text-error' : 'text-[#3ee08f]'}`}>{bkBusy || bkMsg}</p>}
        </section>

        <footer className="mt-10 text-center text-caption text-n10">Criado por <span className="text-gold">{CREATOR}</span> · {YEAR} · <button onClick={() => setAbout('sobre')} className="text-gold hover:underline">Sobre o Josué {__APP_VERSION__}</button></footer>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/80 backdrop-blur-sm">
          <div className="rounded-r6 border-2 border-dashed border-gold px-10 py-12 text-center">
            <IUpload size={36} className="mx-auto text-gold" />
            <p className="mt-3 text-[18px] font-medium">Solte para transcrever</p>
          </div>
        </div>
      )}
      {tunerOpen && <TunerDialog onClose={() => setTunerOpen(false)} />}
      {about && <AboutDialog startOnNews={about === 'novidades'} onClose={() => setAbout(null)} />}
      <PrivacyNotice onSettings={showSettings} onServer={useServer} />
    </div>
  )
}



function statusText(s: Song) {
  if (s.status === 'queued') return 'Na fila'
  if (s.status === 'processing') return `Processando (etapa ${Math.max(1, s.step)}/${STEPS.length})`
  if (s.status === 'error') return 'Erro'
  return 'Pronto'
}

const filterSel = (on: boolean) => `h-8 rounded-full border bg-n2 px-2 text-caption outline-none ${on ? 'border-gold text-gold' : 'border-n6 text-n11'}`

function SongRow({ song: s }: { song: Song }) {
  const [confirm, setConfirm] = useState(false)
  const date = new Date(s.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  const meta = [date, s.meta.duration ? formatTime(s.meta.duration) : null, s.meta.key ? `Tom ${s.meta.key}` : null, s.meta.bpm ? `${s.meta.bpm} BPM` : null].filter(Boolean).join(' · ')
  const color = s.status === 'ready' ? 'text-[#3ee08f] bg-[#1f9d5c]/25' : s.status === 'error' ? 'text-error bg-error/10' : s.status === 'processing' ? 'text-gold bg-gold/10' : 'text-n11 bg-n4'
  const overall = s.status === 'processing' ? ((Math.max(1, s.step) - 1) + s.progress) / 7 : 0
  return (
    <li className="group relative flex items-center gap-4 rounded-r5 border border-n5/70 bg-n2/70 p-3 transition hover:border-gold/60 hover:bg-n3/70">
      <button onClick={() => navigate(`/musica/${s.id}`)} className="absolute inset-0 rounded-r5" aria-label={`Abrir ${s.title}`} />
      <Cover hue={s.hue} size={56} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-semibold text-n12">{s.title}</p>
        <p className="mt-0.5 truncate text-sm2 text-n11">{meta}</p>
        {s.status === 'processing' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-n4"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${overall * 100}%` }} /></div>
        )}
        {s.status === 'error' && s.error && <p className="mt-0.5 truncate text-caption text-error/90">{s.error}</p>}
      </div>
      <span className={`hidden shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold sm:inline ${color}`}>{statusText(s)}</span>
      <button onClick={() => void touchSong(s.id, { favorite: !s.favorite })} aria-pressed={!!s.favorite} title={s.favorite ? 'Tirar das favoritas' : 'Marcar como favorita'} aria-label="Favorita"
        className={`relative z-10 grid h-8 w-8 place-items-center rounded-r4 text-[20px] leading-none hover:bg-n4 ${s.favorite ? 'text-gold' : 'text-n8 hover:text-gold'}`}>{s.favorite ? '★' : '☆'}</button>
      {s.status === 'error' && (
        <button onClick={() => retry(s.id)} title="Tentar de novo" className="relative z-10 grid h-8 w-8 place-items-center rounded-r4 text-n11 hover:bg-n4 hover:text-n12"><IRetry size={18} /></button>
      )}
      {confirm ? (
        <div className="relative z-10 flex items-center gap-1">
          <button onClick={() => void deleteSong(s.id)} className="h-8 rounded-r4 bg-error/15 px-2 text-caption font-semibold text-error hover:bg-error/25">Excluir</button>
          <button onClick={() => setConfirm(false)} className="h-8 rounded-r4 px-2 text-caption text-n11 hover:bg-n4">Cancelar</button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} title="Excluir" aria-label={`Excluir ${s.title}`} className="relative z-10 grid h-8 w-8 place-items-center rounded-r4 text-n9 opacity-100 hover:bg-n4 hover:text-error lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"><ITrash size={18} /></button>
      )}
      <IChevron size={22} className="-rotate-90 shrink-0 text-n12" />
      <span className={`absolute right-3 top-2 rounded-full px-1.5 text-[10px] font-semibold sm:hidden ${color}`}>{statusText(s)}</span>
    </li>
  )
}
