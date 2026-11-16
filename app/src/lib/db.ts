// Armazenamento local (IndexedDB): músicas e áudios ficam no próprio navegador.
import type { Setlist, Song } from './types'

// nome antigo mantido de propósito: assim as músicas já salvas continuam aparecendo
const DB_NAME = 'cifra-ai'
const VERSION = 2 // 2: repertórios (setlists)
let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio')
      if (!db.objectStoreNames.contains('setlists')) db.createObjectStore('setlists', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const r = fn(t.objectStore(store))
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      }),
  )
}

type Listener = () => void
const listeners = new Set<Listener>()
export function subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l) } }
function emit() { listeners.forEach((l) => l()) }

export async function listSongs(): Promise<Song[]> {
  const all = await tx<Song[]>('songs', 'readonly', (s) => s.getAll() as IDBRequest<Song[]>)
  return all.sort((a, b) => b.createdAt - a.createdAt)
}
export function getSong(id: string) { return tx<Song | undefined>('songs', 'readonly', (s) => s.get(id)) }
export async function putSong(song: Song) { await tx('songs', 'readwrite', (s) => s.put(song)); emit() }
// alterações em fila: duas gravações ao mesmo tempo (ler → mudar → gravar) não apagam uma à outra
let chain: Promise<unknown> = Promise.resolve()
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}
export function patchSong(id: string, patch: Partial<Song>) {
  return queued(async () => {
    const cur = await getSong(id)
    if (!cur) return
    await putSong({ ...cur, ...patch, updatedAt: Date.now() })
  })
}
/** Muda só marcações (favorita, última abertura) sem mexer na data de edição da música. */
export function touchSong(id: string, patch: Pick<Partial<Song>, 'favorite' | 'lastOpenedAt'>) {
  return queued(async () => {
    const cur = await getSong(id)
    if (cur) await putSong({ ...cur, ...patch })
  })
}
export async function deleteSong(id: string) {
  await tx('songs', 'readwrite', (s) => s.delete(id))
  await tx('audio', 'readwrite', (s) => s.delete(id))
  emit()
}
export function putAudio(id: string, blob: Blob) { return tx('audio', 'readwrite', (s) => s.put(blob, id)) }
export function getAudio(id: string) { return tx<Blob | undefined>('audio', 'readonly', (s) => s.get(id)) }

// ---- repertórios ----
export async function listSetlists(): Promise<Setlist[]> {
  const all = await tx<Setlist[]>('setlists', 'readonly', (s) => s.getAll() as IDBRequest<Setlist[]>)
  return all.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt)
}
export function getSetlist(id: string) { return tx<Setlist | undefined>('setlists', 'readonly', (s) => s.get(id)) }
export async function putSetlist(s: Setlist) { await tx('setlists', 'readwrite', (st) => st.put({ ...s, updatedAt: Date.now() })); emit() }
export async function deleteSetlist(id: string) { await tx('setlists', 'readwrite', (s) => s.delete(id)); emit() }
