// Música de exemplo: áudio sintetizado no próprio navegador (sem voz) com letra e cifra prontas,
// para mostrar a tela de cifra antes do primeiro envio.
import { chordPitchClasses } from './chords'
import { encodeWav } from './audio'
import { listSongs, putAudio, putSong } from './db'
import type { ChordEvent, Section, Song, Word } from './types'

const BPM = 96
const BEAT = 60 / BPM
const BAR = BEAT * 4

// [compasso inicial, acordes por compasso]
const PLAN: { label: string; bars: string[]; lines?: string[] }[] = [
  { label: 'Intro', bars: ['G', 'D', 'Em7', 'Cadd9'] },
  { label: 'Verso', bars: ['G', 'D/F#', 'Em7', 'C', 'G', 'D/F#', 'C', 'D'], lines: ['Acordei com o sol batendo na janela', 'o café passando devagar', 'a cidade ainda dorme lá fora', 'e eu aprendo a recomeçar'] },
  { label: 'Refrão', bars: ['C', 'G', 'D', 'Em7', 'C', 'G', 'Dsus4', 'D'], lines: ['Deixa o vento levar', 'o que não cabe mais aqui', 'deixa a música tocar', 'que eu encontro o caminho por aí'] },
  { label: 'Final', bars: ['G', 'D', 'Cadd9', 'G'] },
]

export function demoData() {
  const words: Word[] = []
  const chords: ChordEvent[] = []
  const sections: Section[] = []
  let bar = 0
  for (const part of PLAN) {
    const t0 = bar * BAR
    part.bars.forEach((c, i) => chords.push({ t0: (bar + i) * BAR, t1: (bar + i + 1) * BAR, chord: c }))
    part.lines?.forEach((line, li) => {
      // cada verso ocupa 2 compassos; a voz entra meio tempo antes do compasso
      const start = (bar + li * 2) * BAR + BEAT * 0.5
      const end = start + BAR * 2 - BEAT * 1.5
      const ws = line.split(' ')
      const total = ws.reduce((a, w) => a + w.length + 1.5, 0)
      let t = start
      for (const w of ws) {
        const d = ((end - start) * (w.length + 1.5)) / total
        words.push({ t0: +t.toFixed(3), t1: +(t + d * 0.92).toFixed(3), text: w })
        t += d
      }
    })
    bar += part.bars.length
    sections.push({ t0, t1: bar * BAR, label: part.label })
  }
  return { words, chords, sections, duration: bar * BAR + BEAT * 2 }
}

async function renderDemoAudio(chords: ChordEvent[], words: Word[], duration: number): Promise<Blob> {
  const sr = 22050
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr)
  const master = ctx.createGain(); master.gain.value = 0.55
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp).connect(ctx.destination)
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
  const noise = ctx.createBuffer(1, sr, sr)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  const pluck = (t: number, midi: number, vel: number, pan: number, dur = 0.9, type: OscillatorType = 'triangle') => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(midi)
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    const p = ctx.createStereoPanner(); p.pan.value = pan
    o.connect(g).connect(p).connect(master); o.start(t); o.stop(t + dur + 0.05)
  }
  for (const c of chords) {
    const pc = chordPitchClasses(c.chord)!
    const voicing = pc.pcs.map((p) => { let m = 55 + ((p - 55) % 12 + 12) % 12; if (m < 55) m += 12; return m }).sort((a, b) => a - b)
    // pad
    for (const m of voicing.slice(0, 4)) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = (Math.random() - 0.5) * 8
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300
      const g = ctx.createGain(); g.gain.setValueAtTime(0, c.t0); g.gain.linearRampToValueAtTime(0.028, c.t0 + 0.25); g.gain.setValueAtTime(0.028, c.t1 - 0.1); g.gain.linearRampToValueAtTime(0, c.t1 + 0.05)
      o.connect(f).connect(g).connect(master); o.start(c.t0); o.stop(c.t1 + 0.1)
    }
    // dedilhado em colcheias
    const arp = [...voicing, voicing[1] + 12, voicing[0] + 12, voicing[2]]
    for (let k = 0; k < 8; k++) pluck(c.t0 + k * BEAT / 2, arp[k % arp.length], k % 2 ? 0.06 : 0.09, k % 2 ? 0.3 : -0.3)
    // baixo nos tempos 1 e 3
    const bass = 36 + ((pc.bass - 36) % 12 + 12) % 12
    pluck(c.t0, bass, 0.35, 0, BEAT * 1.8, 'sine')
    pluck(c.t0 + BEAT * 2, bass + (c.t1 - c.t0 > BEAT * 3 ? 0 : 0), 0.3, 0, BEAT * 1.8, 'sine')
    // bateria
    for (let k = 0; k < 4; k++) {
      const t = c.t0 + k * BEAT
      if (k % 2 === 0) {
        const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
        const g = ctx.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
        o.connect(g).connect(master); o.start(t); o.stop(t + 0.3)
      } else {
        const s = ctx.createBufferSource(); s.buffer = noise
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800
        const g = ctx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
        s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.2)
      }
      for (const h of [0, 0.5]) {
        const s = ctx.createBufferSource(); s.buffer = noise
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000
        const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t + h * BEAT); g.gain.exponentialRampToValueAtTime(0.001, t + h * BEAT + 0.05)
        s.connect(f).connect(g).connect(master); s.start(t + h * BEAT); s.stop(t + h * BEAT + 0.06)
      }
    }
  }
  // "voz" instrumental: uma nota por palavra, nota do acorde do momento
  for (const w of words) {
    const c = chords.find((x) => w.t0 >= x.t0 && w.t0 < x.t1) ?? chords[0]
    const pc = chordPitchClasses(c.chord)!
    const p = pc.pcs[(w.text.length + Math.round(w.t0)) % Math.min(3, pc.pcs.length)]
    const midi = 67 + ((p - 67) % 12 + 12) % 12
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(midi)
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5
    const vg = ctx.createGain(); vg.gain.value = 3
    vib.connect(vg).connect(o.frequency)
    const g = ctx.createGain(); g.gain.setValueAtTime(0, w.t0); g.gain.linearRampToValueAtTime(0.09, w.t0 + 0.04); g.gain.setValueAtTime(0.09, Math.max(w.t0 + 0.05, w.t1 - 0.05)); g.gain.linearRampToValueAtTime(0, w.t1)
    o.connect(g).connect(master); o.start(w.t0); o.stop(w.t1 + 0.02); vib.start(w.t0); vib.stop(w.t1 + 0.02)
  }
  const buf = await ctx.startRendering()
  return encodeWav(buf)
}

export const DEMO_ID = 'exemplo-manha'
const SEEDED = 'cifra-ai:demo-seeded'

export async function seedDemo(force = false) {
  if (!force && localStorage.getItem(SEEDED)) return
  const existing = (await listSongs()).find((s) => s.id === DEMO_ID)
  if (existing && !force) { localStorage.setItem(SEEDED, '1'); return }
  const { words, chords, sections, duration } = demoData()
  const song: Song = {
    id: DEMO_ID, title: 'Manhã de Recomeço (exemplo)', createdAt: Date.now() - 60_000, updatedAt: Date.now(),
    fileName: 'exemplo.wav', mime: 'audio/wav', size: 0,
    status: 'ready', step: 8, progress: 1,
    meta: { bpm: BPM, key: 'G', timeSig: '4/4', duration, language: 'pt' },
    words, chords, sections, engine: 'browser', demo: true, hue: 186,
  }
  localStorage.setItem(SEEDED, '1')
  const blob = await renderDemoAudio(chords, words, duration)
  await putAudio(DEMO_ID, blob)
  await putSong({ ...song, size: blob.size, updatedAt: Date.now() })
}
