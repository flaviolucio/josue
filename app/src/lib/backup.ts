// Backup da biblioteca num arquivo único ".josue": músicas (cifra, edições, tablaturas), áudios,
// arquivos do Guitar Pro e repertórios. Formato: "JOSUEBK1" + tamanho do cabeçalho (4 bytes) +
// cabeçalho JSON + os arquivos em sequência (sem converter para texto, então não pesa na memória).
import { getAudio, getSong, listSetlists, listSongs, putAudio, putSetlist, putSong } from './db'
import type { Setlist, Song } from './types'
import { loadSingers, mergeSingers, type SingerPrefs } from './singers'

const MAGIC = 'JOSUEBK1'
interface Header {
  format: 'josue-backup'; version: 1; createdAt: number
  songs: Song[]; setlists: Setlist[]; singers?: SingerPrefs
  files: { id: string; size: number; type: string }[]
}

export async function exportBackup(onProgress?: (msg: string) => void): Promise<{ songs: number; setlists: number; bytes: number }> {
  const songs = (await listSongs()).filter((s) => !s.demo)
  const setlists = await listSetlists()
  const files: Header['files'] = []
  const blobs: Blob[] = []
  for (const [i, s] of songs.entries()) {
    onProgress?.(`Juntando ${i + 1} de ${songs.length}…`)
    const b = await getAudio(s.id)
    if (b) { files.push({ id: s.id, size: b.size, type: b.type }); blobs.push(b) }
  }
  const header: Header = { format: 'josue-backup', version: 1, createdAt: Date.now(), songs, setlists, singers: loadSingers(), files }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, json.length, true)
  const out = new Blob([new TextEncoder().encode(MAGIC), len, json, ...blobs], { type: 'application/octet-stream' })
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(out)
  a.download = `Josue-backup-${stamp}.josue`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return { songs: songs.length, setlists: setlists.length, bytes: out.size }
}

/** Restaura sem apagar nada: acrescenta o que falta e atualiza o que no backup está mais novo. */
export async function importBackup(file: File, onProgress?: (msg: string) => void): Promise<{ added: number; updated: number; kept: number; setlists: number }> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) throw new Error('Este arquivo não é um backup do Josué (.josue).')
  const len = new DataView(head.buffer).getUint32(8, true)
  let header: Header
  try { header = JSON.parse(await file.slice(12, 12 + len).text()) } catch { throw new Error('O backup está danificado (não foi possível ler o índice).') }
  if (header.format !== 'josue-backup') throw new Error('Formato de backup desconhecido.')

  // posição de cada arquivo dentro do backup
  const where = new Map<string, { off: number; size: number; type: string }>()
  let off = 12 + len
  for (const f of header.files) { where.set(f.id, { off, size: f.size, type: f.type }); off += f.size }
  if (off > file.size) throw new Error('O backup está incompleto (o arquivo parece cortado).')

  let added = 0, updated = 0, kept = 0
  for (const [i, s] of header.songs.entries()) {
    onProgress?.(`Restaurando ${i + 1} de ${header.songs.length}…`)
    const cur = await getSong(s.id)
    if (cur && cur.updatedAt >= s.updatedAt) { kept++; continue }
    const f = where.get(s.id)
    if (f) await putAudio(s.id, new Blob([await file.slice(f.off, f.off + f.size).arrayBuffer()], { type: f.type }))
    // uma música que estava "processando" quando o backup foi feito volta para a fila
    await putSong(s.status === 'processing' ? { ...s, status: 'queued', step: 0, progress: 0 } : s)
    if (cur) updated++; else added++
  }
  if (header.singers) mergeSingers(header.singers)
  const existing = new Map((await listSetlists()).map((x) => [x.id, x]))
  let sl = 0
  for (const x of header.setlists ?? []) {
    const cur = existing.get(x.id)
    if (cur && cur.updatedAt >= x.updatedAt) continue
    await putSetlist(x); sl++
  }
  return { added, updated, kept, setlists: sl }
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`
}
