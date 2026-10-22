export interface ListContinuation {
  readonly value: string
  readonly caret: number
}

export const continueMarkdownList = (input: { readonly text: string; readonly start: number; readonly end: number }): ListContinuation | null => {
  const lineStart = input.text.lastIndexOf('\n', input.start - 1) + 1
  const beforeCaret = input.text.slice(lineStart, input.start)
  const unordered = /^(\s*)([-*+])\s+(.*)$/.exec(beforeCaret)
  const ordered = /^(\s*)(\d+)\.\s+(.*)$/.exec(beforeCaret)
  const match = unordered ?? ordered
  if (match === null) return null

  const [, indent, marker, content] = match
  if (indent === undefined || marker === undefined || content === undefined) return null
  const lineEnd = input.text.indexOf('\n', input.end)
  const currentLine = input.text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
  const suffix = input.text.slice(input.end)
  if (content === '' && input.start === input.end && /^\s*(?:[-*+]|\d+\.)\s*$/.test(currentLine)) {
    const value = `${input.text.slice(0, lineStart)}${suffix}`
    return { value, caret: lineStart }
  }

  const nextMarker = unordered !== null ? `${indent}${marker} ` : `${indent}${String(Number(marker) + 1)}. `
  const insertion = `\n${nextMarker}`
  const value = `${input.text.slice(0, input.start)}${insertion}${suffix}`
  return { value, caret: input.start + insertion.length }
}
