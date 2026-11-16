// Repertórios (setlists): listas de músicas para um culto, ensaio ou apresentação, em ordem,
// cada uma no tom em que será tocada. Abre cada música já no tom certo e gera um PDF único.
import { useEffect, useMemo, useState } from 'react'
import { deleteSetlist, getSetlist, listSetlists, listSongs, putSetlist, subscribe } from '../lib/db'
import { exportSetlistPdf, formatDate, hasCifra, itemKeys, setlistFileName } from '../lib/setlist'
import ShareQr from '../components/ShareQr'
import { newId } from '../lib/pipeline'
import { navigate } from '../App'
import type { Setlist, Song } from '../lib/types'
import { rememberSingerKey, singerKey, singerNames } from '../lib/singers'
import { IArrowLeft, IDownload, ITrash } from '../components/Icons'

function useSongs() {
  const [songs, setSongs] = useState<Song[]>([])
  useEffect(() => {
    const load = () => void listSongs().then(setSongs)
    load()
    return subscribe(load)
  }, [])
  return songs
}

function Shell({ title, back, children, right }: { title: string; back: () => void; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg bg-fixed bg-cover bg-top pb-16" style={{ backgroundImage: 'url(./img/fundo-musica.webp)' }}>
      <header className="sticky top-0 z-30 border-b border-gold/20 bg-n1/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1000px] items-center gap-3 px-3 py-3 md:px-6">
          <button onClick={back} className="flex h-9 items-center gap-1 rounded-r4 pl-1 pr-3 text-sm2 text-n11 hover:bg-n3 hover:text-n12"><IArrowLeft size={20} /> Voltar</button>
          <img src="./img/josue-96.png" alt="" width={44} height={44} className="hidden h-11 w-11 rounded-r4 ring-2 ring-gold/70 sm:block" />
          <h1 className="josue-title min-w-0 flex-1 truncate text-[26px] leading-tight">{title}</h1>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-[1000px] px-3 pt-6 md:px-6">{children}</main>
    </div>
  )
}

export default function SetlistPage({ id }: { id?: string }) {
  return id ? <Editor id={id} /> : <List />
}

function List() {
  const [lists, setLists] = useState<Setlist[] | null>(null)
  const songs = useSongs()
  useEffect(() => {
    const load = () => void listSetlists().then(setLists)
    load()
    return subscribe(load)
  }, [])
  const create = async () => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const sl: Setlist = { id: newId(), name: 'Novo repertório', date: iso, items: [], createdAt: Date.now(), updatedAt: Date.now() }
    await putSetlist(sl)
    navigate(`/repertorio/${sl.id}`)
  }
  const byId = new Map(songs.map((s) => [s.id, s]))
  return (
    <Shell title="Repertórios" back={() => navigate('/')} right={<button onClick={() => void create()} className="gold-btn h-10 rounded-r5 px-4 text-sm2 font-bold text-n1">+ Novo repertório</button>}>
      <p className="mb-4 text-sm2 text-n11">Monte a lista de músicas de um culto, ensaio ou apresentação, na ordem e no tom de cada uma. Depois é só tocar em sequência, abrir no modo palco ou gerar um PDF com tudo.</p>
      {lists === null ? <p className="py-10 text-center text-n10">Carregando…</p> : !lists.length ? (
        <div className="rounded-r6 border-2 border-dashed border-gold/40 bg-n1/50 px-6 py-12 text-center">
          <p className="text-body text-n12">Nenhum repertório ainda.</p>
          <button onClick={() => void create()} className="mt-4 h-10 rounded-r5 bg-gold px-4 text-sm2 font-semibold text-n1">Criar o primeiro</button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lists.map((l) => (
            <button key={l.id} onClick={() => navigate(`/repertorio/${l.id}`)} className="rounded-r6 border-2 border-gold/40 bg-n1/70 p-4 text-left backdrop-blur transition hover:border-gold">
              <p className="truncate text-body font-semibold text-n12">{l.name}</p>
              <p className="mt-0.5 text-caption text-n10 first-letter:uppercase">{formatDate(l.date) || 'sem data'}</p>
              <p className="mt-2 line-clamp-2 text-caption text-n11">{l.items.map((it) => byId.get(it.songId)?.title).filter(Boolean).join(' · ') || 'Sem músicas'}</p>
              <p className="mt-2 text-caption font-semibold text-gold">{l.items.length} {l.items.length === 1 ? 'música' : 'músicas'}</p>
            </button>
          ))}
        </div>
      )}
    </Shell>
  )
}

function Editor({ id }: { id: string }) {
  const [sl, setSl] = useState<Setlist | null | undefined>(undefined)
  const songs = useSongs()
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  useEffect(() => { void getSetlist(id).then((s) => setSl(s ?? null)) }, [id])
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs])
  const candidates = songs.filter((s) => hasCifra(s))

  if (sl === undefined) return <div className="grid min-h-dvh place-items-center text-n10">Carregando…</div>
  if (sl === null) return <Shell title="Repertório" back={() => navigate('/repertorio')}><p className="text-n10">Este repertório não existe mais.</p></Shell>

  const save = (next: Setlist) => { setSl(next); void putSetlist(next) }
  const move = (i: number, d: number) => {
    const items = [...sl.items]; const j = i + d
    if (j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j], items[i]]
    save({ ...sl, items })
  }
  const patchItem = (i: number, p: Partial<Setlist['items'][number]>) => {
    const it = { ...sl.items[i], ...p }
    // cantor escolhido: o tom vem da preferência dele; mudou o tom: a preferência é guardada
    if (p.singer !== undefined && p.semis === undefined) {
      const pref = p.singer ? singerKey(p.singer, it.songId) : undefined
      if (pref) { it.semis = pref.semis; it.capo = pref.capo }
    } else if (it.singer && (p.semis !== undefined || p.capo !== undefined)) rememberSingerKey(it.singer, it.songId, it.semis, it.capo)
    save({ ...sl, items: sl.items.map((x, k) => (k === i ? it : x)) })
  }
  const add = () => { if (!pick) return; save({ ...sl, items: [...sl.items, { songId: pick, semis: 0 }] }); setPick('') }
  const open = (i: number) => navigate(`/musica/${sl.items[i].songId}?set=${sl.id}&i=${i}`)
  const makeBlob = async () => (await exportSetlistPdf(sl, byId, true)) as Blob
  const pdf = async () => {
    setBusy(true); setMsg('')
    try { await exportSetlistPdf(sl, byId) } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  const btn = 'grid h-8 w-8 place-items-center rounded-r4 text-n11 hover:bg-n4 hover:text-n12 disabled:opacity-30'
  return (
    <Shell title={sl.name || 'Repertório'} back={() => navigate('/repertorio')} right={
      <button onClick={() => void pdf()} disabled={busy || !sl.items.length} className="flex h-10 items-center gap-2 rounded-r5 border-2 border-gold/80 bg-n1/60 px-4 text-sm2 font-semibold text-n12 hover:bg-n2/80 disabled:opacity-50">
        <IDownload size={18} /> <span className="hidden sm:inline">{busy ? 'Gerando…' : 'PDF do repertório'}</span>
      </button>
    }>
      <div className="rounded-r6 border-2 border-gold/50 bg-n1/70 p-4 backdrop-blur md:p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <label className="text-caption text-n11">Nome
            <input value={sl.name} onChange={(e) => save({ ...sl, name: e.target.value })} placeholder="Ex.: Culto de domingo"
              className="mt-1 h-10 w-full rounded-r4 border border-n6 bg-n2 px-3 text-sm2 text-n12 outline-none focus:border-gold" />
          </label>
          <label className="text-caption text-n11">Data
            <input type="date" value={sl.date ?? ''} onChange={(e) => save({ ...sl, date: e.target.value })}
              className="mt-1 h-10 w-full rounded-r4 border border-n6 bg-n2 px-3 text-sm2 text-n12 outline-none focus:border-gold [color-scheme:dark]" />
          </label>
        </div>
        <label className="mt-3 block text-caption text-n11">Observações (saem na capa do PDF)
          <textarea value={sl.notes ?? ''} onChange={(e) => save({ ...sl, notes: e.target.value })} rows={2} placeholder="Ex.: ministro, banda, ordem do culto…"
            className="mt-1 w-full resize-y rounded-r4 border border-n6 bg-n2 px-3 py-2 text-sm2 text-n12 outline-none focus:border-gold" />
        </label>
      </div>

      <div className="mt-4 rounded-r6 border-2 border-gold/50 bg-n1/70 p-2 backdrop-blur md:p-3">
        {!sl.items.length && <p className="px-3 py-6 text-center text-sm2 text-n10">Adicione músicas da sua biblioteca abaixo.</p>}
        {sl.items.map((it, i) => {
          const s = byId.get(it.songId)
          const k = s ? itemKeys(s, it) : null
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-r4 px-2 py-2 hover:bg-n2/60 md:flex-nowrap">
              <span className="w-7 text-center font-mono text-sm2 font-bold text-gold">{String(i + 1).padStart(2, '0')}</span>
              <button onClick={() => open(i)} disabled={!s} className="min-w-0 flex-1 truncate text-left text-sm2 font-medium text-n12 hover:text-gold disabled:text-n9" title="Abrir a música neste tom">
                {s ? s.title : 'Música removida da biblioteca'}
              </button>
              {s && k && (
                <div className="flex items-center gap-1">
                  <span className="text-caption text-n10">Tom</span>
                  <button className={btn} onClick={() => patchItem(i, { semis: Math.max(-6, it.semis - 1) })} aria-label="Meio tom abaixo">−</button>
                  <span className="w-12 text-center font-mono text-sm2 font-semibold text-gold">{k.sounding || '–'}</span>
                  <button className={btn} onClick={() => patchItem(i, { semis: Math.min(6, it.semis + 1) })} aria-label="Meio tom acima">+</button>
                  <select value={it.capo ?? 0} onChange={(e) => patchItem(i, { capo: Number(e.target.value) })} aria-label="Capotraste" className="h-8 rounded-r4 border border-n5 bg-n2 px-1 text-caption text-n12">
                    <option value={0}>Sem capo</option>
                    {Array.from({ length: 7 }, (_, c) => c + 1).map((c) => <option key={c} value={c}>Capo {c}</option>)}
                  </select>
                </div>
              )}
              <input value={it.singer ?? ''} onChange={(e) => patchItem(i, { singer: e.target.value })} list="josue-cantores" placeholder="Quem canta" title="O tom escolhido fica guardado para este cantor nesta música"
                className="h-8 w-[120px] rounded-r4 border border-n5 bg-n2 px-2 text-caption text-n12 outline-none focus:border-gold" />
              <div className="flex items-center">
                <button className={btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                <button className={btn} onClick={() => move(i, 1)} disabled={i === sl.items.length - 1} aria-label="Descer">▼</button>
                <button className={btn + ' hover:text-error'} onClick={() => save({ ...sl, items: sl.items.filter((_, k2) => k2 !== i) })} aria-label="Tirar do repertório"><ITrash size={16} /></button>
              </div>
            </div>
          )
        })}
        <div className="mt-2 flex gap-2 border-t border-n4 px-2 pt-3">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-10 min-w-0 flex-1 rounded-r4 border border-n6 bg-n2 px-2 text-sm2 text-n12 outline-none focus:border-gold">
            <option value="">Escolha uma música da biblioteca…</option>
            {candidates.filter((s) => !s.gp).map((s) => <option key={s.id} value={s.id}>{s.title}{s.meta.key ? ` (${s.meta.key})` : ''}</option>)}
          </select>
          <button onClick={add} disabled={!pick} className="h-10 rounded-r4 bg-gold px-4 text-sm2 font-semibold text-n1 disabled:opacity-40">Adicionar</button>
        </div>
      </div>

      <datalist id="josue-cantores">{singerNames().map((n) => <option key={n} value={n} />)}</datalist>
      {qrOpen && <ShareQr fileName={setlistFileName(sl)} make={makeBlob} onClose={() => setQrOpen(false)} />}
      {msg && <p role="alert" className="mt-3 rounded-r4 bg-error/15 px-3 py-2 text-sm2 text-error">{msg}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sl.items.length > 0 && <button onClick={() => setQrOpen(true)} className="h-10 rounded-r5 border-2 border-gold/70 bg-n1/60 px-4 text-sm2 font-semibold text-n12 hover:bg-n2/80">📱 QR Code para a banda</button>}
        {sl.items.length > 0 && <button onClick={() => open(0)} className="gold-btn h-10 rounded-r5 px-4 text-sm2 font-bold text-n1">▶ Começar pela primeira</button>}
        <span className="text-caption text-n10">Dentro da música, use as setas do repertório para ir para a próxima.</span>
        <div className="ml-auto">
          {confirmDel ? (
            <span className="flex items-center gap-2 text-caption text-n11">Excluir este repertório? (as músicas continuam na biblioteca)
              <button onClick={() => { void deleteSetlist(sl.id).then(() => navigate('/repertorio')) }} className="h-8 rounded-r4 bg-error px-3 font-semibold text-white">Excluir</button>
              <button onClick={() => setConfirmDel(false)} className="h-8 rounded-r4 px-2 text-n11 hover:bg-n3">Cancelar</button>
            </span>
          ) : <button onClick={() => setConfirmDel(true)} className="flex h-8 items-center gap-1 rounded-r4 px-2 text-caption text-n10 hover:text-error"><ITrash size={14} /> Excluir repertório</button>}
        </div>
      </div>
    </Shell>
  )
}
