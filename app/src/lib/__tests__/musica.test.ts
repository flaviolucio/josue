// Testes das partes musicais do Josué. Rodar com:  npm test
import { describe, expect, it } from 'vitest'
import { chordPitchClasses, parseChord, simplifyChord, transposeChord, transposeKey } from '../chords'
import { bestCapo, buildBars, degreeOf, hardestChanges, voicings } from '../theory'
import { chordShape, setDiagramTuning } from '../diagrams'
import { detectPitch, midiToFreq, noteToMidi } from '../tuner'
import { computeFeatures, markInversionsFromAudio, markPowerChords, resolvePowerChords } from '../analysis'
import { reviewChords } from '../review'
import { labelSections } from '../sections'
import { detectModulation } from '../modulation'
import { suggestPicking, suggestStrum } from '../rhythm'
import type { ChordEvent } from '../types'

const ev = (names: string[], dur = 4): ChordEvent[] => names.map((chord, i) => ({ t0: i * dur, t1: (i + 1) * dur, chord }))

describe('acordes', () => {
  it('transpõe', () => {
    expect(transposeChord('G', 2)).toBe('A')
    expect(transposeChord('D/F#', 2)).toBe('E/G#')
    expect(transposeChord('Bm7(b5)', 1, true)).toBe('Cm7(b5)')
    expect(transposeKey('Bm', 1)).toBe('Cm')
  })
  it('simplifica, mas mantém power chord', () => {
    expect(simplifyChord('G7M')).toBe('G')
    expect(simplifyChord('Gm(7M)')).toBe('Gm')
    expect(simplifyChord('D5')).toBe('D5')
  })
  it('entende a notação brasileira e o power chord', () => {
    expect(chordPitchClasses('Gm(7M)')?.pcs.sort((a, b) => a - b)).toEqual([2, 6, 7, 10]) // G Bb D F#
    expect(chordPitchClasses('Bm7(b5)')?.pcs.sort((a, b) => a - b)).toEqual([2, 5, 9, 11]) // B D F A
    expect(chordPitchClasses('E5')?.pcs.sort((a, b) => a - b)).toEqual([4, 11])
    expect(parseChord('C#m7')?.root).toBe(1)
  })
})

describe('teoria', () => {
  it('graus', () => {
    expect(degreeOf('Em', 'G')).toBe('vi')
    expect(degreeOf('D7', 'G')).toBe('V7')
    expect(degreeOf('C', 'G')).toBe('IV')
    expect(degreeOf('D/F#', 'G')).toBe('V/VII')
  })
  it('capo inteligente: Bb pede capo 3 (desenhos de G)', () => {
    const tips = bestCapo(ev(['G', 'D', 'Em', 'C']), 3)
    expect(tips[0].capo).toBe(3)
    expect(tips[0].openShare).toBe(1)
  })
  it('outras posições do acorde', () => {
    const v = voicings('A')
    expect(v.length).toBeGreaterThanOrEqual(3)
    expect(v.some((s) => s.frets.join() === '5,7,7,6,5,5')).toBe(true) // pestana na 5ª (forma de E)
  })
  it('trocas difíceis vêm primeiro', () => {
    const top = hardestChanges(ev(['G', 'C', 'G', 'F', 'Bm', 'F', 'Bm']))
    expect([top[0].a, top[0].b].sort()).toEqual(['Bm', 'F'])
  })
  it('compassos', () => {
    const beats = Array.from({ length: 32 }, (_, i) => i * 0.5)
    const bars = buildBars(ev(['G', 'D', 'Em', 'C'], 2), beats, 4, [])
    expect(bars[0].slots).toEqual(['G', '.', '.', '.'])
    expect(bars[1].slots).toEqual(['D', '.', '.', '.'])
  })
  it('batida e dedilhado', () => {
    expect(suggestStrum('3/4', 90).pattern).toContain('↓')
    expect(suggestPicking('4/4', 80).pattern[0]).toBe('P')
  })
})

describe('diagramas em afinação alternativa', () => {
  it('Drop D: power chord com um dedo', () => {
    setDiagramTuning('dropd')
    expect(chordShape('D5', 'violao')?.frets).toEqual([0, 0, 0, -1, -1, -1])
    expect(chordShape('E5', 'violao')?.frets).toEqual([2, 2, 2, -1, -1, -1])
    setDiagramTuning('padrao')
  })
  it('meio tom abaixo: para soar Eb, faz o desenho de E', () => {
    setDiagramTuning('meio')
    expect(chordShape('Eb', 'violao')?.frets).toEqual([0, 2, 2, 1, 0, 0])
    setDiagramTuning('padrao')
  })
})

describe('afinador', () => {
  const tone = (f: number, amp = 0.2, sr = 48000, n = 8192) => {
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) for (let h = 1; h <= 4; h++) x[i] += (amp / h) * Math.sin((2 * Math.PI * f * h * i) / sr)
    return x
  }
  it('acha a nota das 6 cordas', () => {
    for (const n of ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']) {
      const f = midiToFreq(noteToMidi(n))
      const got = detectPitch(tone(f), 48000, 40, 900)
      expect(got).not.toBeNull()
      expect(Math.abs(1200 * Math.log2(got! / f))).toBeLessThan(5) // menos de 5 cents
    }
  })
  it('ignora silêncio', () => { expect(detectPitch(new Float32Array(8192), 48000)).toBeNull() })
})

// sinais sintéticos (guitarra distorcida) para as passadas de áudio
const sr = 22050, seg = 4
function synth(segs: number[][], dist = 1.8, bassFirst = false) {
  const x = new Float32Array(sr * seg * segs.length)
  segs.forEach((notes, k) => {
    for (let i = 0; i < sr * seg; i++) {
      const t = i / sr
      let v = 0
      notes.forEach((m, j) => { const f = 440 * 2 ** ((m - 69) / 12); for (let h = 1; h <= 8; h++) v += ((bassFirst && j === 0 ? 1.4 : bassFirst ? 0.5 : 1) * Math.sin(2 * Math.PI * f * h * t)) / h })
      x[k * sr * seg + i] = bassFirst ? v * 0.08 : Math.tanh(dist * v * 0.3) * 0.6
    }
  })
  return x
}

describe('power chords', () => {
  it('reconhece D5 e E5 e deixa as tríades', () => {
    const x = synth([[50, 57, 62], [50, 54, 57, 62], [50, 53, 57, 62], [52, 59, 64]])
    const out = markPowerChords(computeFeatures(x, sr), ev(['D', 'D', 'Dm', 'E']))
    expect(out.map((c) => c.chord)).toEqual(['D5', 'D', 'Dm', 'E5'])
  })
  it('volta ao acorde normal pela terça', () => {
    const x = synth([[50, 54, 57, 62], [50, 53, 57, 62]])
    expect(resolvePowerChords(computeFeatures(x, sr), ev(['D5', 'D5'])).map((c) => c.chord)).toEqual(['D', 'Dm'])
  })
})

describe('inversões pelo baixo', () => {
  it('acha D/F# e C/E', () => {
    const x = synth([[42, 62, 66, 69], [40, 60, 64, 67], [38, 62, 66, 69]], 0, true)
    expect(markInversionsFromAudio(x, sr, ev(['D', 'C', 'D']), false).map((c) => c.chord)).toEqual(['D/F#', 'C/E', 'D'])
  })
})

describe('revisão e seções', () => {
  it('aponta acorde fora do tom e a piscada', () => {
    const chords: ChordEvent[] = [...ev(['G', 'C#m', 'D']), { t0: 12, t1: 14, chord: 'C' }, { t0: 14, t1: 14.3, chord: 'A' }, { t0: 14.3, t1: 16, chord: 'C' }]
    const f = reviewChords(chords, 'G')
    expect(f.find((x) => x.index === 1)?.suggestion).toBe('C')
    expect(f.find((x) => x.index === 4)?.kind).toBe('curto')
  })
  it('numera seções repetidas', () => {
    const s = labelSections([{ t0: 0, t1: 10, label: 'Verso' }, { t0: 10, t1: 20, label: 'Refrão' }, { t0: 20, t1: 30, label: 'Verso' }, { t0: 30, t1: 40, label: 'Refrão' }], [{ t0: 1, t1: 2, text: 'a' }, { t0: 35, t1: 36, text: 'b' }])
    expect(s.map((x) => x.label)).toEqual(['Verso 1', 'Refrão 1', 'Verso 2', 'Refrão 2'])
  })
  it('detecta a modulação do último refrão', () => {
    const chords = [...ev(['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C']), ...ev(['G#', 'D#', 'Fm', 'C#', 'G#', 'D#', 'Fm', 'C#']).map((c) => ({ ...c, t0: c.t0 + 48, t1: c.t1 + 48 }))]
    const sections = [{ t0: 0, t1: 16, label: 'Verso' }, { t0: 16, t1: 32, label: 'Refrão' }, { t0: 32, t1: 48, label: 'Refrão' }, { t0: 48, t1: 80, label: 'Refrão' }]
    const m = detectModulation(chords, sections, 'G')
    expect(m?.t0).toBe(48)
    expect(m?.semis).toBe(1)
  })
})
