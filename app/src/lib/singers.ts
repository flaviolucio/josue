// Tom preferido de cada cantor/ministro em cada música. Ao escolher o cantor num repertório,
// a música já vem no tom dele; ao mudar o tom com o cantor escolhido, a preferência é guardada.
const KEY = 'josue.singers'
export type SingerPrefs = Record<string, Record<string, { semis: number; capo?: number }>>

export function loadSingers(): SingerPrefs {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as SingerPrefs } catch { return {} }
}
export function saveSingers(p: SingerPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* sem armazenamento */ }
}
export const singerNames = () => Object.keys(loadSingers()).sort((a, b) => a.localeCompare(b, 'pt-BR'))

export function singerKey(singer: string, songId: string) {
  return loadSingers()[singer.trim()]?.[songId]
}
export function rememberSingerKey(singer: string, songId: string, semis: number, capo?: number) {
  const name = singer.trim()
  if (!name) return
  const p = loadSingers()
  p[name] = { ...(p[name] ?? {}), [songId]: { semis, capo } }
  saveSingers(p)
}
/** usado pelo backup */
export function mergeSingers(other: SingerPrefs) {
  const p = loadSingers()
  for (const [n, songs] of Object.entries(other ?? {})) p[n] = { ...(p[n] ?? {}), ...songs }
  saveSingers(p)
}
