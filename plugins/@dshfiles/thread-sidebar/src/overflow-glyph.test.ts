import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file: string): string => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

describe('one overflow glyph (council round 15 A2)', () => {
  // Every overflow trigger the list draws: the row's hover strip and touch menu, the folder rows, the sidebar header,
  // the usage-limit rows and the navigation rail's More.
  it.each([
    ['client.tsx', 2],
    ['sidebar-folders.tsx', 2],
    ['sidebar-shell.tsx', 1],
    ['usage-limit-section.tsx', 1],
    ['navigation-icon-row.tsx', 1],
  ])('%s draws the kit OverflowGlyph (16px, stroke 2), never a thin, 14px or vertical variant', (file, triggers) => {
    const source = read(file)
    expect(source.match(/<OverflowGlyph \/>/gu)).toHaveLength(triggers)
    expect(source).not.toMatch(/<(EllipsisIcon|EllipsisVerticalIcon|MoreVerticalIcon|MoreHorizontalIcon)\b/u)
  })
})
