import { MAX_DRAFT_CHARS, MAX_DRAFT_ITEMS, type Annotation } from './schema.js'

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim()

const severityTag = (annotation: Annotation): string => {
  const parts: string[] = []
  if (annotation.severity !== undefined) parts.push(annotation.severity)
  if (annotation.intent !== undefined) parts.push(annotation.intent)
  return parts.length === 0 ? '' : `[${parts.join(' · ')}] `
}

const label = (annotation: Annotation): string => {
  const tag = annotation.target.tag
  const text = annotation.target.text
  if (text === undefined) return tag
  const short = text.length > 48 ? `${text.slice(0, 48)}…` : text
  return `${tag} "${short}"`
}

export const formatAnnotation = ({ annotation, index }: { readonly annotation: Annotation; readonly index: number }): string => {
  const lines = [`${index + 1}. ${severityTag(annotation)}${label(annotation)}`]
  lines.push(`   selector: ${annotation.target.selector}`)
  if (annotation.target.url.length > 0) lines.push(`   page: ${annotation.target.url}`)
  if (annotation.target.source !== undefined) {
    lines.push(`   source: ${annotation.target.source.file}:${annotation.target.source.line}`)
  }
  if (annotation.target.staleReason !== undefined) lines.push(`   stale: ${annotation.target.staleReason}`)
  if (annotation.note.trim().length > 0) lines.push(`   note: ${oneLine(annotation.note)}`)
  return lines.join('\n')
}

export const formatAnnotationBlock = ({ annotations }: { readonly annotations: readonly Annotation[] }): string => {
  const selected = annotations.slice(0, MAX_DRAFT_ITEMS)
  if (selected.length === 0) return ''
  const header = `Annotated UI feedback (${selected.length})`
  const body = selected.map((annotation, index) => formatAnnotation({ annotation, index })).join('\n')
  const omitted = annotations.length - selected.length
  const footer = omitted > 0 ? `\n(+${omitted} more not inserted)` : ''
  const block = `${header}\n${body}${footer}`
  return block.length <= MAX_DRAFT_CHARS ? block : `${block.slice(0, MAX_DRAFT_CHARS - 1)}…`
}
