// Nomes de seção mais claros na cifra: numera as que se repetem (Refrão 1, Refrão 2…) e chama
// de "Final" a última parte quando ela não tem letra. Só muda a exibição; o que está salvo fica igual.
import type { Section, Word } from './types'

export function labelSections(sections: Section[], words: Word[]): Section[] {
  if (!sections.length) return sections
  const base = (l: string) => l.replace(/\s+\d+$/, '').trim()
  const out = sections.map((s) => ({ ...s }))
  // última seção sem nenhuma palavra cantada (e não é a única): "Final"
  const last = out[out.length - 1]
  const sung = words.some((w) => w.t0 >= last.t0 - 0.05 && w.t0 < last.t1)
  if (out.length > 1 && !sung && /^(instrumental|solo|intro|outro|ponte)$/i.test(base(last.label))) last.label = 'Final'
  const total: Record<string, number> = {}
  for (const s of out) total[base(s.label)] = (total[base(s.label)] ?? 0) + 1
  const seen: Record<string, number> = {}
  for (const s of out) {
    const b = base(s.label)
    if (total[b] > 1 && b !== 'Final') { seen[b] = (seen[b] ?? 0) + 1; s.label = `${b} ${seen[b]}` }
  }
  return out
}
