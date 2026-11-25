import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const panel = (): string => readFileSync(fileURLToPath(new URL('boards-panel.tsx', import.meta.url)), 'utf8')

describe('the Whiteboard page', () => {
  it('is a kit Page titled as the rail names it, with the project as a header select', () => {
    const source = panel()
    expect(source).toContain('<Page')
    expect(source).toContain('heading="Whiteboard"')
    expect(source).not.toContain('<PageHeader')
    expect(source).toMatch(/meta=\{\s*props\.projects\.length > 1 \? \(\s*<Select/u)
  })

  it('names no library in its description', () => {
    expect(panel()).not.toContain('Excalidraw boards saved')
  })
})
