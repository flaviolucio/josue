// Análise musical feita no navegador: cromagrama, acordes (modelos + Viterbi), BPM e batidas
// (fluxo espectral + programação dinâmica), tonalidade (Krumhansl), compasso e seções
// (matriz de auto-similaridade + novidade). Tudo em código próprio, sem dependências.
import { noteName, preferFlats } from './chords'
import type { ChordEvent, Section, Word } from './types'

// ---------- FFT ----------
function fftInPlace(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

function hann(n: number) { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); return w }

/** Espectrograma de magnitude. Chama onFrame(frameIndex, mag). */
function stft(x: Float32Array, n: number, hop: number, onFrame: (f: number, mag: Float32Array) => void) {
  const w = hann(n)
  const re = new Float32Array(n), im = new Float32Array(n), mag = new Float32Array(n / 2)
  const frames = Math.max(1, Math.floor((x.length - n) / hop) + 1)
  for (let f = 0; f < frames; f++) {
    const off = f * hop
    for (let i = 0; i < n; i++) { re[i] = (x[off + i] ?? 0) * w[i]; im[i] = 0 }
    fftInPlace(re, im)
    for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k])
    onFrame(f, mag)
  }
  return frames
}

// ---------- Recursos ----------
export interface Features {
  sr: number
  chromaHop: number
  chroma: Float32Array[] // 12 por quadro
  bassChroma: Float32Array[]
  energy: Float32Array
  onsetFps: number
  onset: Float32Array
}

export function computeFeatures(x: Float32Array, sr: number, progress?: (p: number) => void): Features {
  // Cromagrama: janela 4096, salto 2048 (~93 ms a 22 kHz)
  const N = 4096, H = 2048
  const binPc: Int8Array = new Int8Array(N / 2).fill(-1)
  const binW = new Float32Array(N / 2)
  const bassPc: Int8Array = new Int8Array(N / 2).fill(-1)
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N
    const midi = 12 * Math.log2(f / 440) + 69
    const near = Math.round(midi)
    const dev = Math.abs(midi - near)
    const pc = ((near % 12) + 12) % 12
    if (f >= 80 && f <= 2200) { binPc[k] = pc; binW[k] = Math.exp(-(dev * dev) / (2 * 0.18 * 0.18)) }
    if (f >= 38 && f < 135) bassPc[k] = pc
  }
  const chroma: Float32Array[] = []
  const bassChroma: Float32Array[] = []
  const total = Math.floor((x.length - N) / H) + 1
  const energyArr: number[] = []
  stft(x, N, H, (f, mag) => {
    const c = new Float32Array(12), b = new Float32Array(12)
    let e = 0
    for (let k = 1; k < N / 2; k++) {
      const m = mag[k]
      e += m * m
      const lm = Math.log1p(m * 20)
      if (binPc[k] >= 0) c[binPc[k]] += lm * binW[k]
      if (bassPc[k] >= 0) b[bassPc[k]] += lm
    }
    chroma.push(c); bassChroma.push(b); energyArr.push(Math.sqrt(e / (N / 2)))
    if (progress && f % 50 === 0) progress((f / total) * 0.6)
  })

  // Envelope de ataques: fluxo espectral em log, janela 1024 / salto 512
  const n2 = 1024, h2 = 512
  const prev = new Float32Array(n2 / 2)
  const onsetArr: number[] = []
  const total2 = Math.floor((x.length - n2) / h2) + 1
  stft(x, n2, h2, (f, mag) => {
    let flux = 0
    for (let k = 2; k < n2 / 2; k++) {
      const v = Math.log1p(mag[k] * 100)
      const d = v - prev[k]
      if (d > 0) flux += d
      prev[k] = v
    }
    onsetArr.push(flux)
    if (progress && f % 400 === 0) progress(0.6 + (f / total2) * 0.4)
  })
  const onset = Float32Array.from(onsetArr)
  // remove tendência local (média móvel de ~1 s) e normaliza
  const win = 43
  const smooth = movingAverage(onset, win)
  let mx = 1e-9
  for (let i = 0; i < onset.length; i++) { onset[i] = Math.max(0, onset[i] - smooth[i]); mx = Math.max(mx, onset[i]) }
  for (let i = 0; i < onset.length; i++) onset[i] /= mx
  return { sr, chromaHop: H, chroma, bassChroma, energy: Float32Array.from(energyArr), onsetFps: sr / h2, onset }
}

function movingAverage(a: Float32Array, w: number) {
  const out = new Float32Array(a.length)
  let s = 0
  const half = Math.floor(w / 2)
  const pre = new Float64Array(a.length + 1)
  for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i]
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(a.length, i + half + 1)
    s = (pre[hi] - pre[lo]) / (hi - lo)
    out[i] = s
  }
  return out
}

// ---------- Andamento e batidas ----------
export function estimateTempo(onset: Float32Array, fps: number): number {
  const minLag = Math.floor((60 * fps) / 200), maxLag = Math.ceil((60 * fps) / 55)
  let best = 0, bestLag = Math.round((60 * fps) / 120)
  const scores: number[] = []
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag]
    s /= onset.length - lag
    const bpm = (60 * fps) / lag
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2))
    scores[lag] = s * prior
    if (s * prior > best) { best = s * prior; bestLag = lag }
  }
  // refino parabólico
  const a = scores[bestLag - 1] ?? 0, b = scores[bestLag], c = scores[bestLag + 1] ?? 0
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
  return (60 * fps) / (bestLag + Math.max(-0.5, Math.min(0.5, shift)))
}

export function trackBeats(onset: Float32Array, fps: number, bpm: number): number[] {
  const period = (60 * fps) / bpm
  const n = onset.length
  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  const alpha = 400
  for (let t = 0; t < n; t++) {
    let best = -Infinity, arg = -1
    const lo = Math.max(0, Math.floor(t - 2 * period)), hi = Math.floor(t - period / 2)
    for (let p = lo; p <= hi; p++) {
      const r = Math.log((t - p) / period)
      const v = score[p] - alpha * r * r
      if (v > best) { best = v; arg = p }
    }
    score[t] = onset[t] + (arg >= 0 ? Math.max(0, best) : 0)
    back[t] = arg >= 0 && best > 0 ? arg : -1
  }
  // escolhe o melhor final na última janela de um período
  let end = n - 1, bestEnd = -Infinity
  for (let t = Math.max(0, Math.floor(n - period)); t < n; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t }
  const beats: number[] = []
  for (let t = end; t >= 0; t = back[t]) { beats.push(t / fps); if (back[t] < 0) break }
  beats.reverse()
  // completa o começo com o período, se faltar
  while (beats.length && beats[0] - period / fps > 0.05) beats.unshift(beats[0] - period / fps)
  return beats
}

// ---------- Tonalidade (Krumhansl-Schmuckler) ----------
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: ArrayLike<number>, b: ArrayLike<number>) {
  const n = a.length
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y }
  return num / Math.sqrt(da * db + 1e-12)
}

export function estimateKey(profile: ArrayLike<number>): { key: string; root: number; minor: boolean; confidence: number } {
  let best = -2, root = 0, minor = false
  for (let r = 0; r < 12; r++) {
    const rot = Array.from({ length: 12 }, (_, i) => profile[(i + r) % 12])
    const cM = corr(rot, KK_MAJOR), cm = corr(rot, KK_MINOR)
    if (cM > best) { best = cM; root = r; minor = false }
    if (cm > best) { best = cm; root = r; minor = true }
  }
  const flatName = noteName(root, true) + (minor ? 'm' : '')
  const name = preferFlats(flatName) ? flatName : noteName(root, false) + (minor ? 'm' : '')
  return { key: name, root, minor, confidence: best }
}

// ---------- Acordes ----------
const QUALITIES: { q: string; iv: number[]; w: number[]; bias: number; adv: boolean }[] = [
  { q: '', iv: [0, 4, 7], w: [1, 0.9, 0.8], bias: 0.0, adv: false },
  { q: 'm', iv: [0, 3, 7], w: [1, 0.9, 0.8], bias: 0.0, adv: false },
  { q: '7', iv: [0, 4, 7, 10], w: [1, 0.85, 0.75, 0.6], bias: -0.08, adv: true },
  { q: 'm7', iv: [0, 3, 7, 10], w: [1, 0.85, 0.75, 0.6], bias: -0.08, adv: true },
  { q: '7M', iv: [0, 4, 7, 11], w: [1, 0.85, 0.75, 0.55], bias: -0.12, adv: true },
  { q: 'sus4', iv: [0, 5, 7], w: [1, 0.9, 0.8], bias: -0.1, adv: true },
  { q: 'sus2', iv: [0, 2, 7], w: [1, 0.85, 0.8], bias: -0.11, adv: true },
  { q: 'add9', iv: [0, 2, 4, 7], w: [1, 0.6, 0.85, 0.75], bias: -0.1, adv: true },
  { q: 'dim', iv: [0, 3, 6], w: [1, 0.9, 0.85], bias: -0.12, adv: true },
]

function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < 12; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return d / Math.sqrt(na * nb + 1e-12)
}

function averageFrames(frames: Float32Array[], hopSec: number, t0: number, t1: number) {
  const out = new Float32Array(12)
  const a = Math.max(0, Math.floor(t0 / hopSec)), b = Math.min(frames.length, Math.max(a + 1, Math.ceil(t1 / hopSec)))
  for (let f = a; f < b; f++) for (let i = 0; i < 12; i++) out[i] += frames[f][i]
  const n = Math.max(1, b - a)
  for (let i = 0; i < 12; i++) out[i] /= n
  return out
}

function normalizeChroma(c: Float32Array) {
  // remove o piso (ruído/percussão espalhada) e normaliza
  let mn = Infinity, mx = 0
  for (const v of c) { mn = Math.min(mn, v); mx = Math.max(mx, v) }
  const out = new Float32Array(12)
  for (let i = 0; i < 12; i++) out[i] = mx > mn ? (c[i] - mn) / (mx - mn) : 0
  return out
}

export function recognizeChords(ft: Features, beats: number[], duration: number, keyRoot: number, keyMinor: boolean): ChordEvent[] {
  const hopSec = ft.chromaHop / ft.sr
  // grade: meia batida para acompanhar trocas rápidas, sem passar de 0,6 s
  const grid: number[] = []
  const b = beats.length > 1 ? beats : Array.from({ length: Math.ceil(duration / 0.5) }, (_, i) => i * 0.5)
  if (b[0] > 0.05) grid.push(0)
  for (let i = 0; i < b.length; i++) {
    grid.push(b[i])
    const next = b[i + 1] ?? Math.min(duration, b[i] + (b[i] - (b[i - 1] ?? b[i] - 0.5)))
    if (next - b[i] > 1.2) grid.push((b[i] + next) / 2)
  }
  grid.push(duration)
  const T = grid.length - 1
  // energia para detectar silêncio (sem acorde)
  let eMax = 0
  for (const e of ft.energy) eMax = Math.max(eMax, e)

  const states: { root: number; qi: number }[] = []
  for (let r = 0; r < 12; r++) for (let qi = 0; qi < QUALITIES.length; qi++) states.push({ root: r, qi })
  const NC = states.length // índice do "sem acorde"
  const S = NC + 1
  const templates = states.map(({ root, qi }) => {
    const t = new Float32Array(12)
    QUALITIES[qi].iv.forEach((iv, j) => (t[(root + iv) % 12] = QUALITIES[qi].w[j]))
    return t
  })
  // pequeno favorecimento dos acordes diatônicos da tonalidade
  const scale = keyMinor ? [0, 2, 3, 5, 7, 8, 10, 7 + 4] : [0, 2, 4, 5, 7, 9, 11]
  const diatonic = states.map(({ root, qi }) => {
    const q = QUALITIES[qi]
    const rel = (((root - keyRoot) % 12) + 12) % 12
    if (rel === 7 && (q.q === '' || q.q === '7')) return 0.12 // dominante (ex.: F# em Bm)
    const inKey = q.iv.slice(0, 3).every((iv) => scale.includes((((root + iv - keyRoot) % 12) + 12) % 12))
    return inKey ? 0.12 : -0.08
  })

  const emis: Float32Array[] = []
  const bassFrames: Float32Array[] = []
  for (let t = 0; t < T; t++) {
    const c = averageFrames(ft.chroma, hopSec, grid[t], grid[t + 1])
    const bc = averageFrames(ft.bassChroma, hopSec, grid[t], grid[t + 1])
    bassFrames.push(bc)
    const ea = Math.max(0, Math.floor(grid[t] / hopSec)), eb = Math.min(ft.energy.length, Math.max(ea + 1, Math.ceil(grid[t + 1] / hopSec)))
    let e = 0
    for (let k = ea; k < eb; k++) e += ft.energy[k]
    e /= Math.max(1, eb - ea)
    const nc = normalizeChroma(c)
    // o baixo ajuda a decidir a tônica
    const nb = normalizeChroma(bc)
    const row = new Float32Array(S)
    for (let s = 0; s < NC; s++) {
      const st = states[s]
      const q = QUALITIES[st.qi]
      let v = cosine(nc, templates[s]) + q.bias + diatonic[s] + 0.35 * nb[st.root]
      // notas de tensão (7ª, 9ª) precisam aparecer de verdade, não só como harmônico
      if (q.iv.length > 3) { const ext = nc[(st.root + q.iv[3]) % 12]; const thr = q.q === "7M" ? 0.7 : 0.45; if (ext < thr) v -= 0.6 * (thr - ext) }
      row[s] = v
    }
    row[NC] = e < eMax * 0.04 ? 1.2 : 0.35
    emis.push(row)
  }
  // Viterbi com custo fixo de troca
  const beta = 14, change = 3.5
  let prev = new Float32Array(S)
  for (let s = 0; s < S; s++) prev[s] = beta * emis[0]?.[s]
  const bp: Int16Array[] = []
  for (let t = 1; t < T; t++) {
    let bestPrev = 0
    for (let s = 1; s < S; s++) if (prev[s] > prev[bestPrev]) bestPrev = s
    const cur = new Float32Array(S)
    const ptr = new Int16Array(S)
    for (let s = 0; s < S; s++) {
      const stay = prev[s], jump = prev[bestPrev] - change
      if (stay >= jump) { cur[s] = stay; ptr[s] = s } else { cur[s] = jump; ptr[s] = bestPrev }
      cur[s] += beta * emis[t][s]
    }
    bp.push(ptr); prev = cur
  }
  let last = 0
  for (let s = 1; s < S; s++) if (prev[s] > prev[last]) last = s
  const path = new Int16Array(T)
  path[T - 1] = last
  for (let t = T - 1; t > 0; t--) path[t - 1] = bp[t - 1][path[t]]

  // junta trechos iguais e decide inversões pelo baixo
  const flats = preferFlats(noteName(keyRoot, true) + (keyMinor ? 'm' : ''))
  const out: ChordEvent[] = []
  let i = 0
  while (i < T) {
    let j = i
    while (j + 1 < T && path[j + 1] === path[i]) j++
    const s = path[i]
    if (s !== NC) {
      const { root, qi } = states[s]
      const q = QUALITIES[qi]
      const bass = new Float32Array(12)
      for (let k = i; k <= j; k++) for (let p = 0; p < 12; p++) bass[p] += bassFrames[k][p]
      let bArg = 0
      for (let p = 1; p < 12; p++) if (bass[p] > bass[bArg]) bArg = p
      const sorted = [...bass].sort((a, b2) => b2 - a)
      const chordTones = q.iv.map((iv) => (root + iv) % 12)
      let name = noteName(root, flats) + q.q
      if (bArg !== root && chordTones.includes(bArg) && sorted[0] > sorted[1] * 1.35 && bass[bArg] > bass[root] * 1.8) name += '/' + noteName(bArg, flats)
      const t0 = grid[i], t1 = grid[j + 1]
      if (out.length && out[out.length - 1].chord === name && Math.abs(out[out.length - 1].t1 - t0) < 0.01) out[out.length - 1].t1 = t1
      else out.push({ t0, t1, chord: name })
    }
    i = j + 1
  }
  // duração mínima ≈ 1 compasso: acordes curtos são absorvidos pelo vizinho mais longo
  const bd: number[] = []
  for (let k = 1; k < b.length; k++) bd.push(b[k] - b[k - 1])
  bd.sort((x, y) => x - y)
  const beatDur = bd.length ? bd[bd.length >> 1] : 0.5
  const minDur = Math.max(1.0, beatDur * 3.5)
  let cur = out.map((c) => ({ ...c }))
  for (let guard = 0; guard < 200; guard++) {
    let si = -1, sd = Infinity
    cur.forEach((c, k) => { const d = c.t1 - c.t0; if (d < minDur && d < sd) { sd = d; si = k } })
    if (si < 0 || cur.length < 2) break
    const L = cur[si - 1], R = cur[si + 1]
    const target = !L ? R : !R ? L : (L.t1 - L.t0 >= R.t1 - R.t0 ? L : R)
    if (target === L) L.t1 = cur[si].t1; else R.t0 = cur[si].t0
    cur.splice(si, 1)
    for (let k = cur.length - 1; k > 0; k--) if (cur[k].chord === cur[k - 1].chord) { cur[k - 1].t1 = cur[k].t1; cur.splice(k, 1) }
  }
  const kept = cur
  const merged: ChordEvent[] = []
  for (const c of kept) {
    const last = merged[merged.length - 1]
    if (last && last.chord === c.chord && c.t0 - last.t1 < 0.8) last.t1 = c.t1
    else {
      if (last && c.t0 - last.t1 < 0.8) last.t1 = c.t0
      merged.push({ ...c })
    }
  }
  return merged
}

export function keyProfileFromChroma(ft: Features): Float32Array {
  const p = new Float32Array(12)
  for (const c of ft.chroma) { const n = normalizeChroma(c); for (let i = 0; i < 12; i++) p[i] += n[i] }
  return p
}

// ---------- Compasso ----------
export function estimateTimeSignature(onset: Float32Array, fps: number, beats: number[], bpm: number): { timeSig: string; downbeat: number } {
  if (beats.length < 16) return { timeSig: '4/4', downbeat: 0 }
  const acc = beats.map((t) => {
    const c = Math.round(t * fps)
    let m = 0
    for (let k = c - 2; k <= c + 2; k++) m = Math.max(m, onset[k] ?? 0)
    return m
  })
  const score = (m: number) => {
    let best = -Infinity, phase = 0
    for (let ph = 0; ph < m; ph++) {
      let on = 0, off = 0, no = 0, nf = 0
      acc.forEach((a, i) => { if ((i - ph) % m === 0) { on += a; no++ } else { off += a; nf++ } })
      const v = on / Math.max(1, no) - off / Math.max(1, nf)
      if (v > best) { best = v; phase = ph }
    }
    // periodicidade: autocorrelação dos acentos no atraso m
    let ac = 0
    for (let i = m; i < acc.length; i++) ac += acc[i] * acc[i - m]
    return { v: best + 0.5 * (ac / (acc.length - m)), phase }
  }
  const s3 = score(3), s4 = score(4)
  if (s3.v > s4.v * 1.18) return { timeSig: bpm >= 150 ? '6/8' : '3/4', downbeat: s3.phase }
  return { timeSig: '4/4', downbeat: s4.phase }
}

// ---------- Seções ----------
export function detectSections(ft: Features, beats: number[], downbeat: number, beatsPerBar: number, duration: number, words: Word[]): Section[] {
  const hopSec = ft.chromaHop / ft.sr
  // compassos
  const bars: number[] = []
  if (beats.length >= beatsPerBar * 2) {
    for (let i = downbeat; i < beats.length; i += beatsPerBar) bars.push(beats[i])
    if (bars[0] > 1) bars.unshift(0)
    else bars[0] = 0
  } else {
    for (let t = 0; t < duration; t += 2) bars.push(t)
  }
  bars.push(duration)
  const B = bars.length - 1
  if (B < 6) return [{ t0: 0, t1: duration, label: words.length ? 'Verso' : 'Instrumental' }]
  let eMax = 0
  for (const e of ft.energy) eMax = Math.max(eMax, e)
  const feats: Float32Array[] = []
  const energyBar: number[] = []
  for (let b = 0; b < B; b++) {
    const c = normalizeChroma(averageFrames(ft.chroma, hopSec, bars[b], bars[b + 1]))
    const lo = Math.floor(bars[b] / hopSec), hi = Math.max(lo + 1, Math.floor(bars[b + 1] / hopSec))
    let e = 0
    for (let k = lo; k < hi && k < ft.energy.length; k++) e += ft.energy[k]
    e /= hi - lo
    energyBar.push(e / (eMax || 1))
    const f = new Float32Array(14)
    f.set(c, 0)
    f[12] = (e / (eMax || 1)) * 2
    f[13] = vocalCoverage(words, bars[b], bars[b + 1]) * 1.5
    feats.push(f)
  }
  const sim = (a: Float32Array, b: Float32Array) => {
    let d = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    return d / Math.sqrt(na * nb + 1e-12)
  }
  // auto-similaridade com contexto de 2 compassos (diagonal)
  const SSM: Float32Array[] = Array.from({ length: B }, () => new Float32Array(B))
  for (let i = 0; i < B; i++) for (let j = i; j < B; j++) {
    let s = 0, n = 0
    for (let k = 0; k < 2; k++) if (i + k < B && j + k < B) { s += sim(feats[i + k], feats[j + k]); n++ }
    SSM[i][j] = SSM[j][i] = s / n
  }
  // novidade com núcleo "tabuleiro" de 4 compassos
  const L = 4
  const nov = new Float32Array(B)
  for (let c = 0; c < B; c++) {
    let v = 0
    for (let a = -L; a < L; a++) for (let b2 = -L; b2 < L; b2++) {
      const i = c + a, j = c + b2
      if (i < 0 || j < 0 || i >= B || j >= B) continue
      const sign = (a < 0) === (b2 < 0) ? 1 : -1
      const g = Math.exp(-((a + 0.5) ** 2 + (b2 + 0.5) ** 2) / (2 * (L * 0.6) ** 2))
      v += sign * g * SSM[i][j]
    }
    nov[c] = Math.max(0, v)
  }
  // a voz entrando ou saindo também marca começo de seção
  let novMax = 0
  for (const v of nov) novMax = Math.max(novMax, v)
  for (let c = 1; c < B; c++) {
    const before = feats[c - 1][13], after = feats[c][13], after2 = feats[c + 1]?.[13] ?? after
    if (Math.abs(after - before) > 0.7 && Math.abs(after2 - before) > 0.7) nov[c] += novMax * 0.8
  }
  // picos: mínimo de 4 compassos entre fronteiras, preferindo múltiplos de 4
  const mean = nov.reduce((a, b2) => a + b2, 0) / B
  const cand: number[] = []
  for (let c = 2; c < B - 1; c++) {
    if (nov[c] >= nov[c - 1] && nov[c] >= nov[c + 1] && nov[c] > mean * 1.1) cand.push(c)
  }
  cand.sort((a, b2) => nov[b2] - nov[a])
  const chosen: number[] = []
  const maxSections = Math.max(3, Math.round(duration / 22))
  for (const c of cand) {
    if (chosen.every((x) => Math.abs(x - c) >= 4) && chosen.length < maxSections) chosen.push(c)
  }
  chosen.sort((a, b2) => a - b2)
  // trechos cantados muito longos (16+ compassos) são divididos em múltiplos de 8 compassos
  for (let guard = 0; guard < 8; guard++) {
    const bs = [0, ...chosen, B]
    const k = bs.findIndex((b0, i) => i < bs.length - 1 && bs[i + 1] - b0 >= 16 && vocalCoverage(words, bars[b0], bars[bs[i + 1]]) > 0.3)
    if (k < 0) break
    const b0 = bs[k], b1 = bs[k + 1]
    let best = -1
    for (let c = b0 + 8; c <= b1 - 4; c += 8) if (best < 0 || nov[c] > nov[best]) best = c
    if (best < 0) break
    chosen.push(best)
    chosen.sort((a, b2) => a - b2)
  }
  const bounds = [0, ...chosen, B]
  const segs = bounds.slice(0, -1).map((b0, k) => ({ b0, b1: bounds[k + 1] }))

  // agrupa segmentos parecidos (média de cromas + presença de voz)
  // semelhança entre trechos: média da diagonal da auto-similaridade (compasso a compasso)
  const GROUP_SIM = 0.93
  const segSim = (a: { b0: number; b1: number }, b: { b0: number; b1: number }) => {
    const n = Math.min(a.b1 - a.b0, b.b1 - b.b0)
    let s = 0
    for (let k = 0; k < n; k++) s += SSM[a.b0 + k][b.b0 + k]
    const lenRatio = n / Math.max(a.b1 - a.b0, b.b1 - b.b0)
    return (s / Math.max(1, n)) * (0.85 + 0.15 * lenRatio)
  }
  const group = new Array(segs.length).fill(-1)
  let g = 0
  for (let i = 0; i < segs.length; i++) {
    if (group[i] >= 0) continue
    group[i] = g
    for (let j = i + 1; j < segs.length; j++) if (group[j] < 0 && segSim(segs[i], segs[j]) > GROUP_SIM) group[j] = g
    g++
  }
  const info = segs.map((s, k) => {
    const t0 = bars[s.b0], t1 = bars[s.b1]
    let e = 0
    for (let b2 = s.b0; b2 < s.b1; b2++) e += energyBar[b2]
    return { t0, t1, voc: vocalCoverage(words, t0, t1), energy: e / (s.b1 - s.b0), group: group[k] }
  })
  const hasWords = words.length > 0
  const vocalSegs = info.filter((s) => s.voc > 0.15 || !hasWords)
  // refrão: o grupo com voz que mais se repete; empate → mais energia
  const groupStats = new Map<number, { n: number; e: number }>()
  for (const s of vocalSegs) {
    const st = groupStats.get(s.group) ?? { n: 0, e: 0 }
    st.n++; st.e += s.energy
    groupStats.set(s.group, st)
  }
  let chorus = -1, bestScore = -1
  for (const [gid, st] of groupStats) {
    const score = st.n * 2 + st.e / st.n
    if (st.n >= 2 && score > bestScore) { bestScore = score; chorus = gid }
  }
  if (chorus < 0 && vocalSegs.length >= 2) {
    // sem repetição clara: o trecho com voz mais forte vira refrão
    // (em empate, o mais tardio: refrões raramente abrem a música)
    chorus = vocalSegs.slice(1).reduce((a, b2) => (b2.energy >= a.energy * 0.98 ? b2 : a), vocalSegs[1]).group
  }
  const firstChorusIdx = info.findIndex((s) => s.group === chorus)
  const labels = info.map((s, k) => {
    const isVocal = s.voc > 0.15 || !hasWords
    if (!isVocal) {
      if (k === 0) return 'Intro'
      if (k === info.length - 1) return 'Final'
      return s.t1 - s.t0 > 12 ? 'Solo' : 'Instrumental'
    }
    if (s.group === chorus) return 'Refrão'
    const repeats = info.filter((o) => o.group === s.group).length
    if (repeats === 1 && firstChorusIdx >= 0 && k > firstChorusIdx && k < info.length - 1) {
      const next = info[k + 1]
      if (next && next.group === chorus && s.t1 - s.t0 < 20) return 'Pré-refrão'
      return 'Ponte'
    }
    const next = info[k + 1]
    if (next && next.group === chorus && s.t1 - s.t0 <= 14 && k > 0) return 'Pré-refrão'
    return 'Verso'
  })
  // junta vizinhos com o mesmo rótulo
  const out: Section[] = []
  info.forEach((s, k) => {
    const last = out[out.length - 1]
    if (last && last.label === labels[k]) last.t1 = s.t1
    else out.push({ t0: s.t0, t1: s.t1, label: labels[k] })
  })
  return out
}

function vocalCoverage(words: Word[], t0: number, t1: number) {
  let cov = 0
  for (const w of words) {
    const a = Math.max(t0, w.t0), b = Math.min(t1, w.t1 + 0.25)
    if (b > a) cov += b - a
  }
  return Math.min(1, cov / Math.max(0.001, t1 - t0))
}

// ---------- Power chords ----------
/** Troca D/Dm por D5 quando, no trecho, soam forte só a tônica e a quinta (sem terça).
 *  Usa de preferência o áudio da guitarra separada (a voz costuma cantar a terça). */
export function markPowerChords(ft: Features, chords: ChordEvent[]): ChordEvent[] {
  const hopSec = ft.chromaHop / ft.sr
  return chords.map((c) => {
    const m = /^([A-G][#b]?)(m?)(\/[A-G][#b]?)?$/.exec(c.chord) // só tríades simples (maior/menor)
    if (!m || c.t1 - c.t0 < 0.4) return c
    const root = noteIndexLocal(m[1])
    const n = normalizeChroma(averageFrames(ft.chroma, hopSec, c.t0, c.t1))
    const r = n[root], f = n[(root + 7) % 12]
    // a própria tônica gera um harmônico na terça MAIOR (5º harmônico), ainda mais com distorção:
    // desconta essa parte antes de decidir. A terça menor não vem de harmônico, fica como está.
    const majorThird = Math.max(0, n[(root + 4) % 12] - 0.6 * r)
    const third = Math.max(n[(root + 3) % 12], majorThird)
    if (r >= 0.3 && f >= 0.4 && third <= 0.28) return { ...c, chord: m[1] + '5' }
    return c
  })
}
function noteIndexLocal(n: string) {
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let v = base[n[0]]
  if (n[1] === '#') v++
  if (n[1] === 'b') v--
  return (v + 12) % 12
}

/** Caminho inverso: decide se cada X5 seria X (maior) ou Xm (menor), pela terça que mais soa no trecho. */
export function resolvePowerChords(ft: Features, chords: ChordEvent[]): ChordEvent[] {
  const hopSec = ft.chromaHop / ft.sr
  return chords.map((c) => {
    const m = /^([A-G][#b]?)5$/.exec(c.chord)
    if (!m) return c
    const root = noteIndexLocal(m[1])
    const n = normalizeChroma(averageFrames(ft.chroma, hopSec, c.t0, c.t1))
    const minor = n[(root + 3) % 12]
    const major = Math.max(0, n[(root + 4) % 12] - 0.6 * n[root]) // desconta o harmônico da tônica
    return { ...c, chord: m[1] + (minor > major ? 'm' : '') }
  })
}


/** Baixo com precisão: janela longa (≈0,75 s) para separar notas graves vizinhas (F, F#, G…). */
function bassProfile(x: Float32Array, sr: number, t0: number, t1: number): Float32Array {
  const N = 16384, H = 8192
  const out = new Float32Array(12)
  const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(x.length, Math.floor(t1 * sr))
  const re = new Float32Array(N), im = new Float32Array(N)
  for (let s = a; s + N <= Math.max(b, a + N) && s + N <= x.length; s += H) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0 }
    fftInPlace(re, im)
    for (let k = Math.ceil((38 * N) / sr); k < (220 * N) / sr; k++) {
      const f = (k * sr) / N
      const midi = 12 * Math.log2(f / 440) + 69
      const near = Math.round(midi), dev = midi - near
      const w = Math.exp(-(dev * dev) / (2 * 0.12 * 0.12))
      out[((near % 12) + 12) % 12] += w * Math.hypot(re[k], im[k]) * (f < 130 ? 1.5 : 1) // as mais graves pesam mais
    }
    if (s + N >= b) break
  }
  return out
}

/** Inversões a partir do áudio do baixo (de preferência a faixa separada do baixo). */
export function markInversionsFromAudio(x: Float32Array, sr: number, chords: ChordEvent[], flats: boolean): ChordEvent[] {
  const NAMES = flats ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return chords.map((c) => {
    const m = /^([A-G][#b]?)([^/]*)$/.exec(c.chord)
    if (!m || c.t1 - c.t0 < 0.8) return c
    const root = noteIndexLocal(m[1])
    const q = m[2]
    const third = /^(m(?!aj)|min|dim|°)/.test(q) ? 3 : /^(5|sus)/.test(q) ? -1 : 4
    const tones = [7, third, /7M|maj7/.test(q) ? 11 : /7/.test(q) ? 10 : -1].filter((v) => v > 0).map((v) => (root + v) % 12)
    const p = bassProfile(x, sr, c.t0, c.t1)
    let arg = 0
    for (let k = 1; k < 12; k++) if (p[k] > p[arg]) arg = k
    if (arg !== root && tones.includes(arg) && p[arg] > p[root] * 1.5) return { ...c, chord: `${m[1]}${q}/${NAMES[arg]}` }
    return c
  })
}
