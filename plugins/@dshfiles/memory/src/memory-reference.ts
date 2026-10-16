import { z } from 'zod'

const memoryCitationPattern = /\bmemory:\s*((?:`?(?:t:[A-Za-z0-9_-]+(?:#\d+)?|n:[1-9]\d*)`?)(?:\s*[,;]\s*`?(?:t:[A-Za-z0-9_-]+(?:#\d+)?|n:[1-9]\d*)`?)*)/giu
const memoryIdPattern = /(?:t:[A-Za-z0-9_-]+(?:#\d+)?|n:[1-9]\d*)/giu

export type MemoryReferenceMatch = {
  readonly id: string
  readonly range?: string
  readonly start: number
  readonly end: number
}

export const memoryReferenceMatches = (text: string): readonly MemoryReferenceMatch[] => {
  const matches: MemoryReferenceMatch[] = []
  for (const citation of text.matchAll(memoryCitationPattern)) {
    const references = citation[1] ?? ''
    const referencesStart = (citation.index ?? 0) + citation[0].indexOf(references)
    for (const reference of references.matchAll(memoryIdPattern)) {
      const raw = reference[0]
      const start = referencesStart + (reference.index ?? 0)
      const separator = raw.indexOf('#')
      const id = (separator < 0 ? raw : raw.slice(0, separator)).toLowerCase()
      const end = start + raw.length
      if (separator < 0) matches.push({ id, start, end })
      else matches.push({ id, range: raw.slice(separator + 1), start, end })
    }
  }
  return matches
}

const referenceId = z
  .string()
  .regex(/^(?:t:[A-Za-z0-9_-]+|n:[1-9]\d*)$/u)
  .refine(id => !id.startsWith('n:') || Number.isSafeInteger(Number(id.slice(2))))
const eventSequence = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/u)
  .refine(sequence => Number.isSafeInteger(Number(sequence)))
const coordinate = z.number().finite().min(-100_000).max(100_000)

export const memoryReferencePreviewEvent = 'dshfiles:memory-reference-preview'

export const memoryReferencePreviewRequestSchema = z
  .object({
    id: referenceId,
    range: eventSequence.optional(),
    anchor: z
      .object({
        left: coordinate,
        top: coordinate,
        width: z.number().finite().min(0).max(100_000),
        height: z.number().finite().min(0).max(100_000),
      })
      .strict(),
  })
  .strict()

export type MemoryReferencePreviewRequest = z.infer<typeof memoryReferencePreviewRequestSchema>
