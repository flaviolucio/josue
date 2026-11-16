/// <reference lib="webworker" />
// Etapa 2: transcrição da letra com Whisper rodando no navegador (transformers.js),
// com marcação de tempo por palavra.
import { pipeline, env } from '@huggingface/transformers'

// modelos baixados para public/models/ são servidos pelo próprio app (sem download da internet);
// os que não estiverem lá vêm do Hugging Face normalmente
// (só os listados em LOCAL_MODELS: o servidor devolve a página do app para arquivos que não existem)
const LOCAL_MODELS = ['onnx-community/whisper-large-v3-turbo_timestamped']
env.localModelPath = new URL('/models/', self.location.origin).href

type Req = { samples: Float32Array; language: string | null; model: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null
let loadedModel = ''

self.onmessage = async (e: MessageEvent<Req>) => {
  const { samples, language, model } = e.data
  const post = (m: object) => self.postMessage(m)
  try {
    if (!asr || loadedModel !== model) {
      env.allowLocalModels = LOCAL_MODELS.includes(model)
      const files = new Map<string, { loaded: number; total: number }>()
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null))
      asr = await pipeline('automatic-speech-recognition', model, {
        device: hasGpu ? 'webgpu' : 'wasm',
        // modelos grandes em versão comprimida (fp32 do large-v3-turbo passa de 3 GB)
        dtype: /large|turbo/.test(model)
          ? (hasGpu ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' })
          : (hasGpu ? { encoder_model: 'fp32', decoder_model_merged: 'fp32' } : { encoder_model: 'fp32', decoder_model_merged: 'q8' }),
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 1 })
            let l = 0, t = 0
            files.forEach((f) => { l += f.loaded; t += f.total })
            post({ type: 'download', progress: t ? l / t : 0, mb: Math.round(t / 1e6) })
          }
        },
      })
      loadedModel = model
    }
    post({ type: 'transcribing' })
    const SR = 16000, WIN = 30, HOP = 25 // janelas de 30 s com 5 s de sobreposição
    const total = samples.length / SR
    const words: { t0: number; t1: number; text: string }[] = []
    const nWin = Math.max(1, Math.ceil(Math.max(0, total - (WIN - HOP)) / HOP))
    for (let k = 0; k < nWin; k++) {
      const off = k * HOP
      const seg = samples.slice(Math.floor(off * SR), Math.min(samples.length, Math.floor((off + WIN) * SR)))
      if (seg.length < SR * 0.5) break
      // normaliza o volume da janela (voz baixa some menos)
      let peak = 0
      for (let i = 0; i < seg.length; i++) peak = Math.max(peak, Math.abs(seg[i]))
      if (peak < 1e-3) continue
      const g = Math.min(8, 0.9 / peak)
      for (let i = 0; i < seg.length; i++) seg[i] *= g
      const opts: Record<string, unknown> = { return_timestamps: 'word' }
      if (language) { opts.language = language; opts.task = 'transcribe' }
      let out
      try { out = await asr(seg, opts) } catch { out = await asr(seg, { ...opts, return_timestamps: true }) }
      const chunks: { text: string; timestamp: [number, number | null] }[] = out.chunks ?? []
      // cada janela fica com o trecho do meio; a sobreposição é dividida ao meio
      const ownA = k === 0 ? -1 : off + (WIN - HOP) / 2
      const ownB = k === nWin - 1 ? Infinity : off + HOP + (WIN - HOP) / 2
      const merged: { t0: number; t1: number; text: string }[] = []
      for (const c of chunks) {
        const s0 = c.timestamp[0] + off
        const e0 = (c.timestamp[1] ?? c.timestamp[0] + 0.4) + off
        // pedaço sem espaço no começo continua a palavra anterior (ex.: "N" + "ão" -> "Não")
        const glue = !/^\s/.test(c.text) && merged.length > 0
        const parts = c.text.trim().split(/\s+/).filter(Boolean)
        const tot = parts.reduce((a, p) => a + p.length, 0) || 1
        let t = s0
        parts.forEach((p, pi) => {
          const d = parts.length === 1 ? Math.max(e0 - s0, 0.05) : ((e0 - s0) * p.length) / tot
          const last = merged[merged.length - 1]
          if (pi === 0 && glue && last) { last.text += p; last.t1 = t + d }
          else merged.push({ t0: t, t1: t + d, text: p })
          t += d
        })
      }
      for (const w of merged) { const mid = (w.t0 + w.t1) / 2; if (mid >= ownA && mid < ownB) words.push(w) }
      post({ type: 'chunk', progress: (k + 1) / nWin })
    }
    // remove alucinações comuns em trechos instrumentais
    const clean = words.filter((w) => !/^(\[.*\]|\(.*\)|♪+|legendas?|obrigad[oa]\.?)$/i.test(w.text))
    // junta palavras quebradas no acento (ex.: "L" + "á" -> "Lá", "N" + "ão" -> "Não", "consu" + "mado")
    const V = /[aeiouáéíóúâêôãõày]/i
    const SINGLE_OK = /^(a|à|á|e|é|o|ó|y|ô)$/i
    for (let i = clean.length - 1; i > 0; i--) {
      const p = clean[i - 1], w = clean[i]
      const gap = w.t0 - p.t1
      const pBare = p.text.replace(/[^\p{L}]/gu, '')
      const wBare = w.text.replace(/[^\p{L}]/gu, '')
      const prevNoVowel = pBare.length > 0 && !V.test(pBare)
      const fragAccent = /^[áéíóúâêôãõà]/i.test(wBare) && !SINGLE_OK.test(wBare)
      if (gap < 0.35 && !/[.,!?;:]$/.test(p.text) && (prevNoVowel || fragAccent)) {
        p.text += w.text; p.t1 = w.t1; clean.splice(i, 1)
      }
    }
    // remove repetições alucinadas (mesma palavra 4+ vezes seguidas)
    const final = clean.filter((w, i) => !(i >= 3 && [1, 2, 3].every((d) => clean[i - d].text.toLowerCase() === w.text.toLowerCase())))
    post({ type: 'done', words: final })
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.message ?? err) })
  }
}
