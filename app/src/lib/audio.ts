// Decodificação, reamostragem e separação aproximada (canal central) no navegador.

export async function decodeFile(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext()
  try { return await ctx.decodeAudioData(buf) } finally { void ctx.close() }
}

/** Reamostra e mistura para mono. mode: 'mix' (tudo), 'center' (voz ~ meio), 'harmonic' (sem o meio agudo). */
export async function renderMono(src: AudioBuffer, sampleRate: number, mode: 'mix' | 'center' = 'mix'): Promise<Float32Array> {
  const length = Math.ceil((src.duration) * sampleRate)
  const ctx = new OfflineAudioContext(1, length, sampleRate)
  const node = ctx.createBufferSource()
  node.buffer = src
  if (mode === 'center' && src.numberOfChannels >= 2) {
    // voz costuma estar no centro: soma L+R e destaca a faixa da voz (150 Hz – 6 kHz)
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1800; pk.Q.value = 0.7; pk.gain.value = 4
    node.connect(hp).connect(lp).connect(pk).connect(ctx.destination)
  } else {
    node.connect(ctx.destination)
  }
  node.start()
  const out = await ctx.startRendering()
  return out.getChannelData(0).slice()
}

export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true)
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true)
  w(36, 'data'); data.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]))
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2
  }
  return new Blob([data.buffer], { type: 'audio/wav' })
}

/** Recorta um trecho do áudio e devolve como WAV (16 bits, mono) — para reprocessar só uma parte. */
export function sliceToWav(buf: AudioBuffer, t0: number, t1: number): Blob {
  const sr = buf.sampleRate
  const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(buf.length, Math.floor(t1 * sr))
  const n = Math.max(0, b - a)
  const ch = buf.numberOfChannels
  const out = new DataView(new ArrayBuffer(44 + n * 2))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  w(36, 'data'); out.setUint32(40, n * 2, true)
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let c = 0; c < ch; c++) v += data[c][a + i]
    v = Math.max(-1, Math.min(1, v / ch))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([out], { type: 'audio/wav' })
}
