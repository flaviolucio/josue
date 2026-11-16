// "Colar letra": o usuário cola a letra certa e o servidor local só encontra o tempo de cada
// palavra na voz separada (alinhamento forçado). As quebras de linha seguem o texto colado.
import { useState } from 'react'
import { chordServerAlive, lyricsOnServer } from '../lib/api'
import type { Word } from '../lib/types'

interface Props {
  stemsId?: string
  language: string | null
  currentText: string
  onDone: (words: Word[]) => void
  onClose: () => void
}

export default function LyricsDialog({ stemsId, language, currentText, onDone, onClose }: Props) {
  const [text, setText] = useState(currentText)
  const [busy, setBusy] = useState<null | number>(null)
  const [error, setError] = useState('')
  const [diff, setDiff] = useState<DiffPart[] | null>(null)
  const compare = () => {
    if (!text.trim()) { setError('Cole a letra original primeiro.'); return }
    setError(''); setDiff(diffWords(currentText, text))
  }
  const errors = diff ? diff.filter((d) => d.kind !== 'same').length : 0

  const run = async (mode: 'align' | 'transcribe') => {
    setError('')
    if (!stemsId) { setError('Esta música não tem as faixas separadas. Reprocesse com o servidor local ligado.'); return }
    if (!(await chordServerAlive())) { setError('O servidor local do Josué está desligado. Abra o Josué pelo atalho e tente de novo.'); return }
    if (mode === 'align' && !text.trim()) { setError('Cole a letra primeiro.'); return }
    setBusy(0)
    try {
      const words = await lyricsOnServer(stemsId, { language, text: mode === 'align' ? text : undefined }, setBusy)
      if (!words.length) throw new Error('Nenhuma palavra encontrada.')
      onDone(words)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-label="Colar letra" onMouseDown={(e) => { if (e.target === e.currentTarget && busy === null) onClose() }}>
      <div className="flex max-h-[90dvh] w-full max-w-[640px] flex-col rounded-r5 border border-n5 bg-n2 p-5 shadow-2xl shadow-black/60">
        <h2 className="text-body font-semibold text-n12">Letra</h2>
        <p className="mt-1 text-sm2 leading-relaxed text-n10">
          Cole a letra <b className="text-n12">como é cantada</b>, com as repetições escritas por extenso (não use “2x”).
          Cada linha do texto vira uma linha da cifra. Marcações como [Refrão] e linhas só de acordes são ignoradas.
          A IA só encontra o tempo de cada palavra: o texto fica exatamente como você colou.
        </p>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy !== null}
          placeholder={'Cole a letra aqui…'} spellCheck={false}
          className="mt-3 min-h-[280px] flex-1 resize-none rounded-r4 border border-n5 bg-n1 p-3 font-sans text-sm2 leading-relaxed text-n12 outline-none focus:border-gold"
        />
        {diff && (
          <div className="mt-3 max-h-[200px] overflow-y-auto rounded-r4 border border-n5 bg-n1 p-3 text-sm2 leading-relaxed">
            <p className="mb-2 text-caption text-n10">
              {errors ? <>Diferenças entre o que a IA ouviu e a letra colada: <span className="rounded bg-error/25 px-1 text-n12 line-through decoration-error">assim</span> = a IA escreveu e não existe na original · <span className="rounded bg-[#1f9d5c]/30 px-1 text-n12">assim</span> = estava faltando. Para corrigir tudo, clique em “Sincronizar esta letra”.</> : 'A letra da IA está igual à original. 🎉'}
            </p>
            {diff.map((d, i) => d.text === '\n' ? <br key={i} /> : (
              <span key={i} className={d.kind === 'del' ? 'rounded bg-error/25 text-n12 line-through decoration-error' : d.kind === 'add' ? 'rounded bg-[#1f9d5c]/30 text-n12' : 'text-n11'}>{d.text} </span>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-sm2 text-amber">{error}</p>}
        {busy !== null && (
          <div className="mt-3">
            <p className="text-caption text-n10">Processando no servidor local… {Math.round(busy * 100)}%</p>
            <div className="mt-1 h-1 rounded bg-n4"><div className="h-1 rounded bg-gold transition-all" style={{ width: `${Math.max(3, busy * 100)}%` }} /></div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => void run('align')} disabled={busy !== null} className="h-9 rounded-r4 bg-gold px-4 text-sm2 font-semibold text-n1 disabled:opacity-50">Sincronizar esta letra</button>
          <button onClick={compare} disabled={busy !== null} title="Mostra onde a IA errou em relação à letra colada" className="h-9 rounded-r4 border border-gold/60 px-4 text-sm2 font-semibold text-n12 hover:bg-n3 disabled:opacity-50">Comparar{diff ? ` (${errors} diferenças)` : ''}</button>
          <button onClick={() => void run('transcribe')} disabled={busy !== null} title="Ignora o texto acima e transcreve de novo com o Whisper large-v3"
            className="h-9 rounded-r4 bg-n4 px-4 text-sm2 font-semibold text-n12 hover:bg-n5 disabled:opacity-50">Transcrever de novo (IA)</button>
          <button onClick={onClose} disabled={busy !== null} className="ml-auto h-9 rounded-r4 px-3 text-sm2 text-n10 hover:text-n12 disabled:opacity-50">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// ---------- comparação palavra a palavra (maior sequência comum) ----------
type DiffPart = { kind: 'same' | 'add' | 'del'; text: string }
const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '')
function tokens(s: string) {
  const out: string[] = []
  for (const line of s.split('\n')) {
    if (/^\s*\[.*\]\s*$/.test(line)) continue // [Refrão] etc.
    out.push(...line.split(/\s+/).filter(Boolean), '\n')
  }
  return out
}
function diffWords(ai: string, orig: string): DiffPart[] {
  const a = tokens(ai).filter((t) => t !== '\n'), b = tokens(orig)
  const bw = b.map((t) => (t === '\n' ? '\n' : norm(t))), aw = a.map(norm)
  const n = a.length, m = b.length
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = bw[j] !== '\n' && aw[i] === bw[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffPart[] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (j < m && b[j] === '\n') { out.push({ kind: 'same', text: '\n' }); j++; continue }
    if (i < n && j < m && aw[i] === bw[j]) { out.push({ kind: 'same', text: b[j] }); i++; j++ }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { out.push({ kind: 'add', text: b[j] }); j++ }
    else { out.push({ kind: 'del', text: a[i] }); i++ }
  }
  return out
}
