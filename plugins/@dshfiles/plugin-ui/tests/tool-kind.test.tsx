// @vitest-environment jsdom
import type * as React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolCard, type ToolKind, type ToolStatus } from '../src/components/tool-card.js'

afterEach(cleanup)

const glyph = (status: ToolStatus, kind?: ToolKind): string => {
  // The card's `title` prop is its row label, passed as data so it is not read as a native tooltip attribute.
  const card: React.ComponentProps<typeof ToolCard> = { status, title: 'Edited invoice.ts', open: false, onToggle: () => undefined }
  if (kind !== undefined) Object.assign(card, { kind })
  const view = render(<ToolCard {...card} />)
  const svg = view.container.querySelector('svg.lucide')
  const classes = svg?.getAttribute('class') ?? ''
  cleanup()
  return classes
}

describe('ToolCard kind glyph (council round 3 C1, kit)', () => {
  it.each<[ToolKind, string, string]>([
    ['edit', 'lucide-pencil', 'dshx:text-identity-3'],
    ['shell', 'lucide-square-terminal', 'dshx:text-identity-1'],
    ['subagent', 'lucide-bot', 'dshx:text-identity-2'],
    ['read', 'lucide-file-text', 'dshx:text-muted-foreground'],
    ['search', 'lucide-search', 'dshx:text-muted-foreground'],
  ])('draws the %s glyph at 16px in its tone once the call succeeded', (kind, icon, tone) => {
    const classes = glyph('passed', kind)
    expect(classes).toContain(icon)
    expect(classes).toContain(tone)
    expect(classes).toContain('dshx:size-4')
    expect(classes).not.toContain('lucide-circle-check')
  })

  it('keeps the status glyph while the call runs, failed or timed out', () => {
    expect(glyph('running', 'edit')).toContain('lucide-loader-circle')
    expect(glyph('failed', 'shell')).toContain('lucide-circle-x')
    expect(glyph('timeout', 'subagent')).toContain('lucide-circle-x')
    expect(glyph('skipped', 'read')).toContain('lucide-circle-minus')
  })

  it('draws the status glyph as before without a kind', () => {
    expect(glyph('passed')).toContain('lucide-circle-check')
  })
})
