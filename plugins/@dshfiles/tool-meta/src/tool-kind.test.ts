import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const card = (file: string): string => {
  const source = readFileSync(resolve(here, file), 'utf8')
  return source.slice(source.indexOf('<ToolCard'), source.indexOf('>', source.indexOf('<ToolCard')))
}

describe('tool rows carry their kind glyph (round five C1, council round 3)', () => {
  it('marks a file edit as edit (copper pencil once it succeeded) and a read as read (neutral)', () => {
    expect(card('diff-tool-card.tsx')).toContain('kind="edit"')
    expect(card('read-tool-card.tsx')).toContain('kind="read"')
  })
})
