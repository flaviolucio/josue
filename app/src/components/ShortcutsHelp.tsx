// Janela de ajuda com os atalhos de teclado (abre com a tecla ?).
import { IClose } from './Icons'

export const SONG_KEYS: [string, string][] = [
  ['Espaço', 'Tocar / pausar'],
  ['← / →', 'Voltar / avançar 5 segundos'],
  ['A / B', 'Marcar início / fim do trecho para repetir'],
  ['P', 'Modo palco (Esc sai)'],
  ['C', 'Painel “Acorde atual”'],
  ['T', 'Afinador'],
  ['M', 'Metrônomo'],
  ['J', 'Projetor (letra para o telão)'],
  ['R', 'Revisar acordes'],
  ['E', 'Editar a cifra'],
  ['K', 'Tocou certo? (microfone)'],
  ['S', 'Escalas para solar'],
  ['G', 'Graus (I – IV – V)'],
  ['D', 'Dicionário de acordes'],
  ['Page Down / Page Up', 'Próxima / anterior do repertório (pedal)'],
  ['Ctrl + Z', 'Desfazer edição'],
  ['?', 'Esta ajuda'],
]
export const GP_KEYS: [string, string][] = [
  ['Espaço', 'Tocar / pausar'],
  ['A / B', 'Marcar início / fim do trecho para repetir'],
  ['C', 'Painel “Acorde atual”'],
  ['T', 'Afinador'],
  ['M', 'Metrônomo'],
  ['?', 'Esta ajuda'],
]

export default function ShortcutsHelp({ keys, onClose }: { keys: [string, string][]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Atalhos de teclado" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-[460px] rounded-r6 border-2 border-gold/60 bg-n1 p-5 shadow-2xl shadow-black/60">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="josue-title text-[24px]">Atalhos de teclado</h2>
          <button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-r4 text-n10 hover:bg-n4"><IClose size={18} /></button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm2">
          {keys.map(([k, d]) => (
            <div key={k} className="contents">
              <dt className="text-right"><kbd className="rounded-r3 border border-n6 bg-n3 px-1.5 py-0.5 font-mono text-caption text-gold">{k}</kbd></dt>
              <dd className="text-n11">{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/** true quando a tecla foi digitada num campo de texto (aí o atalho não vale) */
export const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement
  return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable
}
