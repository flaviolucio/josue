// Tela de abertura (como a janelinha do Word ao abrir): logo, versículo e o crédito do criador.
import { useEffect, useState } from 'react'
import { VERSE, VERSE_REF } from './Icons'

export const CREATOR = 'Flávio Lúcio Curado'
export const YEAR = 2026

export default function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), 2400)
    const b = setTimeout(onDone, 2900)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [onDone])
  const skip = () => { setLeaving(true); setTimeout(onDone, 300) }

  return (
    <div onClick={skip} role="presentation"
      className={`fixed inset-0 z-[100] grid place-items-center bg-page/95 p-4 transition-opacity duration-500 ${leaving ? 'opacity-0' : 'opacity-100'}`}>
      <div className="splash-in relative w-full max-w-[520px] overflow-hidden rounded-r6 border-2 border-gold/70 bg-cover bg-center shadow-[0_20px_80px_#000d,0_0_50px_#e8b43740]"
        style={{ backgroundImage: 'linear-gradient(180deg, #0b152999 0%, #0b1529e6 60%, #0b1529 100%), url(./img/fundo-inicio.webp)' }}>
        <div className="flex flex-col items-center px-6 pb-5 pt-7 text-center sm:px-10">
          <div className="flex items-center gap-4">
            <img src="./img/josue-96.png" alt="" width={84} height={84} className="h-[72px] w-[72px] rounded-r5 ring-2 ring-gold/80 shadow-[0_6px_30px_#e8b43755] sm:h-[84px] sm:w-[84px]" />
            <h1 className="josue-title text-[56px] leading-none sm:text-[68px]">Josué</h1>
          </div>
          <div className="mt-3 h-[2px] w-3/4 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" />
          <blockquote className="mt-4 font-serif text-[16px] italic leading-snug text-n12 sm:text-[18px]">
            {VERSE} <span className="whitespace-nowrap not-italic text-gold">— {VERSE_REF}</span>
          </blockquote>
          <div className="mt-5 h-[3px] w-40 overflow-hidden rounded bg-n4"><i className="splash-bar block h-full w-2/5 rounded bg-gold" /></div>
          <p className="mt-4 text-[11px] tracking-wide text-n10">Criado por <span className="text-n11">{CREATOR}</span> · {YEAR}</p>
        </div>
      </div>
    </div>
  )
}
