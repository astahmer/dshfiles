import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('whiteboards with nothing saved', () => {
  it('uses the one empty state: a sentence, no icon tile, title or second New board button', () => {
    const panel = source('boards-panel.tsx')
    expect(panel).toContain('<EmptyState')
    expect(panel).not.toMatch(/<EmptyMedia|<EmptyTitle|<EmptyContent/u)
    expect(panel.match(/New board/gu)).toHaveLength(1)
  })
  it('names no agent tool in what the user reads', () => {
    for (const file of ['boards-panel.tsx', 'board-view.tsx']) expect(source(file), file).not.toContain('whiteboard_write')
  })
})
