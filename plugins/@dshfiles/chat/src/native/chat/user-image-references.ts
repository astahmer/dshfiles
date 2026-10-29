export type UserImageReferencePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly index: number }

export interface UserImageReferenceParts {
  readonly parts: readonly UserImageReferencePart[]
  readonly referencedIndexes: ReadonlySet<number>
}

export const userImageReferenceParts = (text: string, imageCount: number): UserImageReferenceParts => {
  const parts: UserImageReferencePart[] = []
  const referencedIndexes = new Set<number>()
  const references = /\[image ([1-9]\d*)\]/giu
  let cursor = 0

  for (let match = references.exec(text); match !== null; match = references.exec(text)) {
    const index = Number(match[1]) - 1
    if (index < 0 || index >= imageCount) continue
    if (cursor < match.index) parts.push({ type: 'text', text: text.slice(cursor, match.index) })
    parts.push({ type: 'image', index })
    referencedIndexes.add(index)
    cursor = match.index + match[0].length
  }

  if (cursor < text.length || parts.length === 0) parts.push({ type: 'text', text: text.slice(cursor) })
  return { parts, referencedIndexes }
}
