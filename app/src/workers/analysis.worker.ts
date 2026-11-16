/// <reference lib="webworker" />
import {
  computeFeatures, detectSections, markInversionsFromAudio, markPowerChords, resolvePowerChords, estimateKey, estimateTempo, estimateTimeSignature, keyProfileFromChroma, recognizeChords, trackBeats,
} from '../lib/analysis'
import type { ChordEvent, Word } from '../lib/types'

// Etapas 3 a 7: acordes, BPM/batidas, tonalidade, compasso e seções.
self.onmessage = (e: MessageEvent<{ samples: Float32Array; sr: number; duration: number; words: Word[]; mode?: 'power' | 'unpower' | 'bass'; flats?: boolean; chords?: ChordEvent[] }>) => {
  const { samples, sr, duration, words } = e.data
  // passada extra: power chords (tônica + quinta, sem terça) a partir da guitarra separada
  if (e.data.mode === 'bass') {
    try { self.postMessage({ type: 'done', chords: markInversionsFromAudio(samples, sr, e.data.chords ?? [], !!e.data.flats) }) }
    catch (err) { self.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) }) }
    return
  }
  if (e.data.mode === 'power' || e.data.mode === 'unpower') {
    const fn = e.data.mode === 'power' ? markPowerChords : resolvePowerChords
    try { self.postMessage({ type: 'done', chords: fn(computeFeatures(samples, sr), e.data.chords ?? []) }) }
    catch (err) { self.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) }) }
    return
  }
  const post = (step: number, progress: number) => self.postMessage({ type: 'progress', step, progress })
  try {
    post(3, 0)
    const ft = computeFeatures(samples, sr, (p) => post(3, p * 0.7))
    // tonalidade antes, só para ajudar os acordes (a etapa é mostrada depois)
    const key = estimateKey(keyProfileFromChroma(ft))
    post(4, 0)
    const bpm = estimateTempo(ft.onset, ft.onsetFps)
    const beats = trackBeats(ft.onset, ft.onsetFps, bpm)
    const realBpm = beats.length > 8 ? 60 / median(diff(beats)) : bpm
    post(3, 0.75)
    const chords = recognizeChords(ft, beats, duration, key.root, key.minor)
    post(5, 1)
    post(6, 0)
    const ts = estimateTimeSignature(ft.onset, ft.onsetFps, beats, realBpm)
    post(7, 0)
    const beatsPerBar = ts.timeSig === '3/4' ? 3 : ts.timeSig === '6/8' ? 6 : 4
    const sections = detectSections(ft, beats, ts.downbeat, beatsPerBar === 6 ? 3 : beatsPerBar, duration, words)
    self.postMessage({
      type: 'done',
      result: { bpm: Math.round(realBpm), key: key.key, timeSig: ts.timeSig, chords, sections, beats },
    })
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) })
  }
}

function diff(a: number[]) { return a.slice(1).map((v, i) => v - a[i]) }
function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0.5 }
