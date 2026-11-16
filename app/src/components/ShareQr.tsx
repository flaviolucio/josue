// Compartilhar o PDF do repertório com a banda: o servidor local publica o arquivo na rede
// Wi-Fi e aqui aparece um QR Code para os celulares abrirem (sem internet, sem cadastro).
import { useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import { CHORD_SERVER, chordServerAlive } from '../lib/api'
import { IClose } from './Icons'

export default function ShareQr({ make, fileName, onClose }: { make: () => Promise<Blob>; fileName: string; onClose: () => void }) {
  const [state, setState] = useState<{ url?: string; svg?: string; err?: string }>({})
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (!(await chordServerAlive())) throw new Error('O servidor local do Josué está desligado. Abra o Josué pelo atalho e tente de novo.')
        const fd = new FormData()
        fd.append('file', await make(), fileName)
        const r = await fetch(`${CHORD_SERVER}/share`, { method: 'POST', body: fd })
        if (!r.ok) throw new Error('O servidor não aceitou o PDF.')
        const { url, ip } = await r.json() as { url: string; ip: string }
        if (ip === '127.0.0.1') throw new Error('Este computador não está conectado a uma rede (Wi-Fi ou cabo). Conecte e tente de novo.')
        const qr = qrcode(0, 'M')
        qr.addData(url)
        qr.make()
        if (alive) setState({ url, svg: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) })
      } catch (e) { if (alive) setState({ err: (e as Error).message }) }
    })()
    return () => { alive = false }
    // gera e publica uma vez só, quando a janela abre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Compartilhar com a banda" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-[420px] rounded-r6 border-2 border-gold/60 bg-n1 p-5 text-center shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between">
          <h2 className="josue-title text-[24px]">Para a banda</h2>
          <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={18} /></button>
        </div>
        {!state.url && !state.err && <p className="py-14 text-sm2 text-n10 pulse-soft">Preparando o PDF…</p>}
        {state.err && <p className="py-8 text-sm2 text-amber">{state.err}</p>}
        {state.url && state.svg && (
          <>
            <div className="mx-auto mt-3 w-[240px] rounded-r4 bg-white p-2" dangerouslySetInnerHTML={{ __html: state.svg }} />
            <p className="mt-3 text-sm2 text-n12">Aponte a câmera do celular para o código.</p>
            <p className="mt-1 text-caption leading-snug text-n10">Os celulares precisam estar na <b className="text-n12">mesma rede Wi-Fi</b> deste computador, com o Josué aberto. Se o Windows perguntar sobre o firewall, permita o acesso em redes privadas.</p>
            <p className="mt-2 break-all font-mono text-[11px] text-n9">{state.url}</p>
          </>
        )}
      </div>
    </div>
  )
}
