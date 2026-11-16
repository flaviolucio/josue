// Sobre o Josué: versão, criador, novidades desta versão e créditos das tecnologias usadas.
// Abre sozinho uma vez depois de cada atualização.
import { useEffect, useState } from 'react'
import { IClose, VERSE, VERSE_REF } from './Icons'
import { CREATOR, YEAR } from './Splash'

export const APP_VERSION = __APP_VERSION__
export const BUILD_DATE = __BUILD_DATE__
const SEEN_KEY = 'josue.seenVersion'

export function shouldShowNews(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== APP_VERSION } catch { return false }
}
function markSeen() { try { localStorage.setItem(SEEN_KEY, APP_VERSION) } catch { /* */ } }

const NEWS: { title: string; items: string[] }[] = [
  { title: 'Cifra mais fiel', items: [
    'Power chords (D5, E5…) detectados na guitarra, com liga/desliga sem perder os acordes normais',
    'Notação brasileira completa no modo Avançado: 7M, m(7M), m7(b5), +',
    'Inversões pelo baixo separado (D/F#, C/E…)',
    'Revisão guiada: acordes suspeitos em laranja, com sugestões — e o Josué aprende com as suas correções',
    'Refazer os acordes de um trecho só · aviso de modulação (“sobe para A”)',
    'Acordes que mudam piscam em dourado por alguns segundos',
  ] },
  { title: 'Para tocar e estudar', items: [
    'Afinador (violão, guitarra, baixo, ukulele, cavaquinho) com várias afinações',
    '“Acorde atual” arrastável, com o próximo acorde e o som real quando há capotraste',
    '“Tocou certo?” pelo microfone · treino de troca de acordes · treino de ouvido',
    'Escalas para solar no braço · graus (I – IV – V) · cifra em compassos',
    'Outras posições do acorde (condução de vozes) · capo inteligente · desenhos em Drop D e afinações mais graves',
    'Batida e dedilhado sugeridos · metrônomo · loop A-B com treino progressivo',
    'Tocar junto com a banda virtual (bateria + baixo) e se gravar · comparar dois tons',
    'Anotações nas linhas da cifra · dicionário de acordes',
  ] },
  { title: 'Guitar Pro', items: [
    'Importa .gp3, .gp4, .gp5, .gpx e .gp com todas as faixas, som de cada instrumento e mixer',
    'Afinador na afinação da faixa · acordes do arquivo no “Acorde atual” · loop A-B',
  ] },
  { title: 'Culto e ensaio', items: [
    'Modo palco (tela cheia, pedal Page Up/Down) · projetor com a letra para o telão',
    'Repertórios com o tom de cada cantor, PDF único e QR Code para a banda',
  ] },
  { title: 'Organização', items: [
    'PDFs com a identidade do Josué (cifra, tablatura completa e repertório)',
    'Backup e restauração da biblioteca · favoritas, recentes e filtros',
    'Atalhos de teclado (tecla ?) · tela de abertura',
  ] },
]

const CREDITS: [string, string][] = [
  ['Whisper (OpenAI) via Transformers.js / faster-whisper', 'transcrição da letra · MIT'],
  ['Demucs (Meta)', 'separação de faixas · MIT'],
  ['BTC — Bi-directional Transformer for Chord recognition', 'reconhecimento de acordes'],
  ['alphaTab', 'tablaturas e Guitar Pro · MPL-2.0'],
  ['Fonte Bravura (Steinberg)', 'símbolos musicais · SIL OFL'],
  ['Sonivox soundfont', 'sons dos instrumentos'],
  ['React, Vite, Tailwind, jsPDF, WaveSurfer', 'interface e exportação'],
]

export default function AboutDialog({ onClose, startOnNews = false }: { onClose: () => void; startOnNews?: boolean }) {
  const [tab, setTab] = useState<'sobre' | 'novidades' | 'creditos'>(startOnNews ? 'novidades' : 'sobre')
  useEffect(() => { markSeen() }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const t = (on: boolean) => `h-9 flex-1 rounded-r4 text-sm2 font-semibold ${on ? 'gold-btn text-n1' : 'bg-n3/80 text-n12 hover:bg-n4'}`
  const date = (() => { try { return new Date(BUILD_DATE).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) } catch { return '' } })()
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3" role="dialog" aria-label="Sobre o Josué" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-r6 border-2 border-gold/70 bg-n1 shadow-[0_20px_80px_#000d,0_0_50px_#e8b43740]">
        <div className="relative bg-cover bg-center px-6 pb-4 pt-6 text-center" style={{ backgroundImage: 'linear-gradient(180deg, #0b152999 0%, #0b1529 100%), url(./img/fundo-inicio.webp)' }}>
          <button onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-r4 text-n11 hover:bg-n4"><IClose size={18} /></button>
          <div className="flex items-center justify-center gap-3">
            <img src="./img/josue-96.png" alt="" width={64} height={64} className="h-16 w-16 rounded-r5 ring-2 ring-gold/80" />
            <div className="text-left">
              <h2 className="josue-title text-[44px] leading-none">Josué</h2>
              <p className="mt-1 text-caption text-n11">Versão <b className="text-gold">{APP_VERSION}</b>{date ? ` · ${date}` : ''}</p>
            </div>
          </div>
          <p className="mt-3 text-sm2 text-n12">Transforme música em cifra — e estude cada detalhe.</p>
        </div>
        <div className="flex gap-1 border-y border-n4 bg-n2/60 p-1.5" role="tablist">
          <button role="tab" aria-selected={tab === 'sobre'} className={t(tab === 'sobre')} onClick={() => setTab('sobre')}>Sobre</button>
          <button role="tab" aria-selected={tab === 'novidades'} className={t(tab === 'novidades')} onClick={() => setTab('novidades')}>Novidades</button>
          <button role="tab" aria-selected={tab === 'creditos'} className={t(tab === 'creditos')} onClick={() => setTab('creditos')}>Créditos</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm2 leading-relaxed text-n11">
          {tab === 'sobre' && (
            <>
              <p>O Josué ouve uma música e devolve a <b className="text-n12">cifra sincronizada</b> — letra, acordes, tom, BPM, compasso e seções — e uma <b className="text-n12">tablatura</b> de guitarra e baixo. Tudo roda neste computador: as músicas ficam salvas só aqui.</p>
              <p className="mt-3">Feito para o músico: afinar, entender a harmonia, treinar as trocas difíceis, solar na escala certa e tocar junto com a banda.</p>
              <blockquote className="mt-5 border-l-2 border-gold pl-3 font-serif italic text-n12">{VERSE} <span className="not-italic text-gold">— {VERSE_REF}</span></blockquote>
              <div className="mt-6 rounded-r5 border border-gold/40 bg-gold/5 p-4 text-center">
                <p className="text-caption uppercase tracking-wider text-n10">Criado por</p>
                <p className="mt-1 text-[20px] font-semibold text-gold">{CREATOR}</p>
                <p className="text-caption text-n10">© {YEAR} · todos os direitos reservados</p>
              </div>
            </>
          )}
          {tab === 'novidades' && (
            <>
              <p className="mb-3 text-n12">O que há de novo na versão <b className="text-gold">{APP_VERSION}</b>:</p>
              {NEWS.map((g) => (
                <div key={g.title} className="mb-4">
                  <p className="mb-1 text-caption font-semibold uppercase tracking-wider text-gold">{g.title}</p>
                  <ul className="list-disc space-y-0.5 pl-5">{g.items.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </>
          )}
          {tab === 'creditos' && (
            <>
              <p className="mb-3">O Josué usa estas tecnologias livres — obrigado a quem as criou:</p>
              <dl className="divide-y divide-n4">
                {CREDITS.map(([n, d]) => <div key={n} className="py-2"><dt className="font-semibold text-n12">{n}</dt><dd className="text-caption text-n10">{d}</dd></div>)}
              </dl>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
