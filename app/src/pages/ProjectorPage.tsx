// Tela da congregação (projetor/telão): só a letra, grande, sem acordes, acompanhando a música
// que está tocando na janela principal do Josué. Abre numa janela separada (arraste para o
// telão e clique para tela cheia). Segue também a troca de músicas do repertório.
import { useEffect, useMemo, useState } from 'react'
import { getSong } from '../lib/db'
import { buildCifra } from '../lib/cifra'
import type { Song } from '../lib/types'

export const PROJECTOR_CHANNEL = 'josue-projetor'
export interface ProjectorMsg { songId: string; time: number; playing: boolean }

/** Abre (ou reaproveita) a janela do projetor. */
export function openProjector(songId: string) {
  window.open(`#/projetor/${songId}`, 'josue-projetor', 'width=1280,height=720')
}

export default function ProjectorPage({ id }: { id: string }) {
  const [songId, setSongId] = useState(id)
  const [song, setSong] = useState<Song | null>(null)
  const [time, setTime] = useState(0)
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem('josue.projSize')) || 64 } catch { return 64 } })
  const [hint, setHint] = useState(true)

  useEffect(() => { void getSong(songId).then((s) => setSong(s ?? null)) }, [songId])
  useEffect(() => {
    const ch = new BroadcastChannel(PROJECTOR_CHANNEL)
    ch.onmessage = (e: MessageEvent<ProjectorMsg>) => {
      if (e.data.songId !== songId) setSongId(e.data.songId)
      setTime(e.data.time)
    }
    return () => ch.close()
  }, [songId])
  useEffect(() => { document.title = 'Josué — Projetor'; const t = setTimeout(() => setHint(false), 6000); return () => clearTimeout(t) }, [])
  useEffect(() => { try { localStorage.setItem('josue.projSize', String(size)) } catch { /* */ } }, [size])

  // só as linhas cantadas, com o tempo de cada uma
  const lines = useMemo(() => {
    if (!song) return []
    const blocks = buildCifra(song.words, [], [], (c) => c)
    return blocks.flatMap((b) => b.lines).filter((l) => l.kind === 'lyric')
      .map((l) => ({ t0: l.t0, t1: l.t1, text: l.kind === 'lyric' ? l.words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim() : '' }))
      .filter((l) => l.text)
  }, [song])
  let cur = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].t0 <= time + 0.3) cur = i
  // depois do fim da linha (intervalo instrumental longo), mostra só a próxima, apagada
  const gap = cur >= 0 && time > lines[cur].t1 + 4
  const now = cur >= 0 && !gap ? lines[cur] : null
  const next = lines[cur + 1]

  const full = () => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}); else void document.exitFullscreen() }
  return (
    <div onDoubleClick={full} className="relative grid h-dvh select-none place-items-center overflow-hidden bg-black px-[6vw] text-center text-white" style={{ fontFamily: 'Inter Variable, Arial, sans-serif' }}>
      <div>
        <p className="font-bold leading-tight transition-opacity duration-300" style={{ fontSize: size, opacity: now ? 1 : 0, textShadow: '0 4px 24px #000' }}>{now?.text ?? next?.text ?? ''}</p>
        {next && <p className="mt-[4vh] font-medium leading-tight text-white/45" style={{ fontSize: size * 0.55 }}>{now ? next.text : ''}</p>}
        {!song && <p className="text-[28px] text-white/50">Abra uma música no Josué…</p>}
      </div>
      <div className={`absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-white/10 p-1.5 text-[13px] text-white/70 transition-opacity ${hint ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
        <span className="px-1">Dois cliques: tela cheia</span>
        <button onClick={() => setSize((s) => Math.max(28, s - 6))} className="h-7 w-8 rounded bg-white/15">A−</button>
        <button onClick={() => setSize((s) => Math.min(140, s + 6))} className="h-7 w-8 rounded bg-white/15">A+</button>
      </div>
    </div>
  )
}
