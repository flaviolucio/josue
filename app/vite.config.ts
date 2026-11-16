import { createReadStream, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { alphaTab } from '@coderline/alphatab-vite'

// Modelos de IA baixados (app/models, vários GB) são servidos direto da pasta em /models/,
// sem passar pelo build (copiar arquivos desse tamanho estoura a memória do Vite).
const MODELS = resolve(import.meta.dirname, 'models')
function localModels(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url || '').split('?')[0])
    if (!url.startsWith('/models/')) return next()
    const file = resolve(MODELS, '.' + url.slice('/models'.length))
    if (!file.startsWith(MODELS + sep)) { res.statusCode = 403; return res.end() }
    let size = 0
    try { const st = statSync(file); if (!st.isFile()) throw 0; size = st.size } catch { res.statusCode = 404; return res.end() }
    res.setHeader('Content-Length', String(size))
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream')
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  }
  return {
    name: 'local-models',
    configureServer(s) { s.middlewares.use(handler) },
    configurePreviewServer(s) { s.middlewares.use(handler) },
  }
}

// O som do alphaTab (tablaturas importadas) roda num "worker". O plugin oficial do alphaTab
// empacota esse worker do jeito certo (o Vite 8, sozinho, reescreve o endereço dele errado).
// As fontes e o banco de sons já ficam em public/, então o plugin não copia nada.
export default defineConfig({
  base: './',
  // versão e data do build, mostradas na tela Sobre
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), tailwindcss(), localModels(), alphaTab({ assetOutputDir: false })],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@huggingface/transformers', '@coderline/alphatab'] },
})
