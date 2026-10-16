import type { ReferenceInsert } from './native/contract/draft-editor.ts'

const mentionPattern = /@\[([^\]]+)\]\((dsh-session:[A-Za-z0-9_-]+)\)/gu
const sessionUriPattern = /^dsh-session:([A-Za-z0-9_-]+)$/u
// `dsh-session:` + base64url(JSON.stringify(sessionId)); a session id never needs JSON escaping, so the
// plain quoted-string form is matched directly instead of parsing transport JSON.
const plainJsonStringPattern = /^"([^"\\]{1,512})"$/u

export type PastedComposerPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reference'; readonly wireText: string; readonly reference: ReferenceInsert }

const isCanonicalSessionMention = (uri: string): boolean => {
  const payload = sessionUriPattern.exec(uri)?.[1]
  if (payload === undefined) return false
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    return plainJsonStringPattern.test(decoded)
  } catch {
    return false
  }
}

export const parsePastedComposerText = (text: string): readonly PastedComposerPart[] => {
  const parts: PastedComposerPart[] = []
  let cursor = 0
  for (const match of text.matchAll(mentionPattern)) {
    const wireText = match[0]
    const label = match[1]
    const uri = match[2]
    const offset = match.index
    if (wireText === undefined || label === undefined || uri === undefined || offset === undefined) continue
    if (!isCanonicalSessionMention(uri)) continue
    if (offset > cursor) parts.push({ kind: 'text', text: text.slice(cursor, offset) })
    parts.push({
      kind: 'reference',
      wireText,
      reference: { source: 'reference', ref: wireText, label, appearance: 'session', clipboardText: wireText },
    })
    cursor = offset + wireText.length
  }
  if (cursor < text.length || parts.length === 0) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}
