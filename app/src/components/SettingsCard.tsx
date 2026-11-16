import { useEffect, useState } from 'react'
import { loadSettings, MODELS, saveSettings, type Settings } from '../lib/settings'
import { chordServerAlive, pingServer } from '../lib/api'

export default function SettingsCard() {
  const [s, setS] = useState<Settings>(loadSettings)
  const [ping, setPing] = useState<'idle' | 'ok' | 'fail' | 'wait'>('idle')
  const [local, setLocal] = useState<boolean | null>(null)
  useEffect(() => { let on = true; const chk = () => chordServerAlive().then((v) => on && setLocal(v)); chk(); const t = setInterval(chk, 10000); return () => { on = false; clearInterval(t) } }, [])
  const update = (p: Partial<Settings>) => { const n = { ...s, ...p }; setS(n); saveSettings(n) }
  const seg = (on: boolean) => `h-8 flex-1 rounded-r3 text-caption font-semibold transition ${on ? 'bg-n5 text-n12' : 'text-n10 hover:text-n12'}`
  const sel = 'h-9 w-full rounded-r4 border border-n4 bg-n1 px-2 text-caption text-n12 outline-none focus:border-gold/60'
  return (
    <div className="rounded-r5 bg-n2 p-4 lg:min-h-[174px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm2 font-medium text-n12">Onde processar</p>
        <div className="flex w-full gap-1 rounded-r4 bg-n1 p-1 sm:w-[300px]" role="tablist">
          <button role="tab" aria-selected={s.engine === 'browser'} className={seg(s.engine === 'browser')} onClick={() => update({ engine: 'browser' })}>Neste navegador</button>
          <button role="tab" aria-selected={s.engine === 'server'} className={seg(s.engine === 'server')} onClick={() => update({ engine: 'server' })}>Servidor com GPU</button>
        </div>
      </div>
      {s.engine === 'browser' ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-caption text-n10">Transcrição da letra {local ? '(sem o servidor local)' : ''}
              <select className={sel + ' mt-1'} disabled={!!local} style={local ? { opacity: 0.5 } : undefined} value={s.model} onChange={(e) => update({ model: e.target.value })}>
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="text-caption text-n10">Idioma da letra
              <select className={sel + ' mt-1'} value={s.language} onChange={(e) => update({ language: e.target.value as Settings['language'] })}>
                <option value="pt">Português (Brasil)</option>
                <option value="auto">Detectar automaticamente</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
              </select>
            </label>
          </div>
          {local ? (
            <p className="mt-2 text-caption leading-snug text-mint">Servidor local ligado: a letra usa o Whisper large-v3 com sincronia por palavra (a opção acima só vale com ele desligado). Para a letra 100% certa, use o botão “Letra…” na música e cole o texto.</p>
          ) : (
            <p className="mt-2 text-caption leading-snug text-n9">Nada sai do seu computador. Com o servidor local do Josué ligado, dá para separar as faixas (Demucs), transcrever com o Whisper large-v3 e gerar a tablatura.</p>
          )}
        </>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            <input value={s.serverUrl} onChange={(e) => { update({ serverUrl: e.target.value }); setPing('idle') }} placeholder="http://localhost:8000" className={sel + ' flex-1 px-3'} />
            <button onClick={async () => { setPing('wait'); setPing((await pingServer(s.serverUrl)) ? 'ok' : 'fail') }} className="h-9 shrink-0 rounded-r4 bg-n4 px-3 text-caption font-semibold text-n12 hover:bg-n5">Testar</button>
          </div>
          <p className={`mt-2 text-caption leading-snug ${ping === 'ok' ? 'text-mint' : ping === 'fail' ? 'text-error' : 'text-n9'}`}>
            {ping === 'ok' ? 'Servidor conectado.' : ping === 'fail' ? 'Não foi possível conectar. Confira o endereço e se o servidor está ligado.' : ping === 'wait' ? 'Testando…' : 'Servidor FastAPI com Demucs (htdemucs), Whisper large-v3 e madmom. Veja o guia no pacote do projeto.'}
          </p>
        </>
      )}
    </div>
  )
}
