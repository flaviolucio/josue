import { useState } from 'react'

const KEY = 'cifraai:aviso-privacidade'

/**
 * Aviso de primeira visita (celular/tablet): explica que o áudio é processado
 * no próprio navegador e que os modelos de IA são baixados uma vez.
 * No computador a mesma informação já aparece no cartão "Onde processar".
 */
export default function PrivacyNotice({ onSettings, onServer }: { onSettings?: () => void; onServer?: () => void }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(KEY) == null && sessionStorage.getItem(KEY) == null } catch { return true }
  })
  if (!open) return null
  const close = (v: string) => {
    try { (v === 'depois' ? sessionStorage : localStorage).setItem(KEY, v) } catch { /* sem armazenamento */ }
    setOpen(false)
  }
  return (
    <div
      role="dialog"
      aria-label="Aviso de privacidade"
      className="fixed bottom-4 right-4 z-40 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[320px] flex-col overflow-y-auto bg-[#222] px-6 pb-[27px] pt-[22px] text-body leading-[20px] text-white shadow-[0_8px_24px_rgba(0,0,0,.45)] lg:hidden"
    >
      <p className="m-0">
        O Josué processa suas músicas aqui mesmo, no seu navegador: o áudio,
        a letra e os acordes ficam salvos só neste aparelho, sem envio para a internet.
      </p>
      <p className="mb-0 mt-[30px]">
        Na primeira transcrição o app baixa o modelo de IA (cerca de 200 MB),
        que fica guardado para as próximas vezes. Você pode trocar isso a qualquer momento.
      </p>
      <button
        type="button"
        onClick={() => { close('config'); onSettings?.() }}
        className="mt-[10px] self-start bg-transparent p-0 text-left text-body text-gold underline"
      >
        Opções de processamento
      </button>
      <div className="mt-5 flex flex-col gap-[5px]">
        <button type="button" onClick={() => close('ok')} className="h-[33px] w-full rounded-[3px] border border-[#ccc] bg-white text-body font-semibold text-[#222]">
          Entendi
        </button>
        <button type="button" onClick={() => { close('servidor'); onServer?.() }} className="h-[33px] w-full rounded-[3px] border border-[#ccc] bg-white text-body font-semibold text-[#222]">
          Prefiro usar o servidor
        </button>
        <button type="button" onClick={() => close('depois')} className="h-[33px] w-full rounded-[3px] border border-[#ccc] bg-white text-body font-semibold text-[#222]">
          Lembrar depois
        </button>
      </div>
    </div>
  )
}
