// Som das notas da tablatura: cordas dedilhadas sintetizadas (Karplus-Strong), tocadas no
// relógio do <audio> da página — acompanham pulos, pausa, velocidade e loop, e a oscilação
// de andamento da gravação (cada nota toca no instante real em que aparece na tablatura).
export interface SynthNote { time: number; dur: number; pitch: number }

const LOOKAHEAD = 0.3 // segundos de música agendados à frente

export class TabSynth {
  private ctx: AudioContext
  private out: GainNode
  private cache = new Map<number, AudioBuffer>()
  private live = new Set<AudioBufferSourceNode>()
  private notes: SynthNote[] = []
  private next = 0
  private timer = 0
  private bass = false

  constructor(private audio: HTMLAudioElement) {
    this.ctx = new AudioContext()
    this.out = this.ctx.createGain()
    const comp = this.ctx.createDynamicsCompressor()
    this.out.connect(comp).connect(this.ctx.destination)
    audio.addEventListener('play', this.onPlay)
    audio.addEventListener('pause', this.reset)
    audio.addEventListener('seeked', this.reset)
    audio.addEventListener('ratechange', this.reset)
    this.timer = window.setInterval(this.tick, 40)
    if (!audio.paused) this.onPlay()
  }

  setNotes(notes: SynthNote[], bass: boolean) {
    this.notes = [...notes].sort((a, b) => a.time - b.time)
    if (bass !== this.bass) { this.bass = bass; this.cache.clear() }
    this.reset()
  }
  setVolume(v: number) { this.out.gain.value = v }

  destroy() {
    window.clearInterval(this.timer)
    this.audio.removeEventListener('play', this.onPlay)
    this.audio.removeEventListener('pause', this.reset)
    this.audio.removeEventListener('seeked', this.reset)
    this.audio.removeEventListener('ratechange', this.reset)
    this.stopAll()
    void this.ctx.close()
  }

  private onPlay = () => { void this.ctx.resume(); this.reset() }

  /** para tudo que soa e recomeça a agenda a partir da posição atual */
  private reset = () => {
    this.stopAll()
    const t = this.audio.currentTime
    let lo = 0, hi = this.notes.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.notes[m].time < t - 0.005) lo = m + 1; else hi = m }
    this.next = lo
  }

  private stopAll() {
    const now = this.ctx.currentTime
    for (const s of this.live) { try { s.stop(now + 0.02) } catch { /* já parou */ } }
    this.live.clear()
  }

  private tick = () => {
    if (this.audio.paused || this.ctx.state !== 'running') return
    const t = this.audio.currentTime
    const rate = this.audio.playbackRate || 1
    const now = this.ctx.currentTime
    while (this.next < this.notes.length && this.notes[this.next].time < t + LOOKAHEAD * rate) {
      const n = this.notes[this.next++]
      const when = now + (n.time - t) / rate
      if (when < now - 0.03) continue // ficou para trás (ex.: aba em segundo plano)
      this.pluck(n.pitch, Math.max(now, when), Math.max(0.12, n.dur / rate))
    }
  }

  private pluck(pitch: number, when: number, dur: number) {
    const { buffer, rate } = this.voice(pitch)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    const g = this.ctx.createGain()
    const end = when + Math.min(dur + 0.08, buffer.duration / rate)
    g.gain.setValueAtTime(this.bass ? 0.9 : 0.55, when)
    g.gain.setValueAtTime(this.bass ? 0.9 : 0.55, Math.max(when, end - 0.06))
    g.gain.linearRampToValueAtTime(0, end)
    src.connect(g).connect(this.out)
    src.start(when)
    src.stop(end + 0.01)
    this.live.add(src)
    src.onended = () => this.live.delete(src)
  }

  /** Karplus-Strong: ruído num laço de atraso com filtro passa-baixa = corda dedilhada */
  private voice(pitch: number): { buffer: AudioBuffer; rate: number } {
    const sr = this.ctx.sampleRate
    const f = 440 * 2 ** ((pitch - 69) / 12)
    const N = Math.max(2, Math.round(sr / f - 0.5)) // o filtro de média soma meia amostra ao período
    const rate = (N + 0.5) / (sr / f) // corrige a afinação exata na reprodução
    let buffer = this.cache.get(pitch)
    if (!buffer) {
      const len = Math.floor(sr * (this.bass ? 2.5 : 2.2))
      buffer = this.ctx.createBuffer(1, len, sr)
      const y = buffer.getChannelData(0)
      // excitação: ruído suavizado (mais escuro no baixo)
      const bright = this.bass ? 0.25 : 0.6
      let prev = 0
      for (let i = 0; i < N; i++) { prev = prev + bright * ((Math.random() * 2 - 1) - prev); y[i] = prev }
      const decay = this.bass ? 0.997 : 0.995 - Math.max(0, pitch - 64) * 0.0004
      for (let i = N; i < len; i++) y[i] = decay * 0.5 * (y[i - N] + y[i - N - 1 < 0 ? 0 : i - N - 1])
      let peak = 0
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]))
      if (peak > 0) for (let i = 0; i < len; i++) y[i] /= peak
      this.cache.set(pitch, buffer)
    }
    return { buffer, rate }
  }
}
