// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ItemGlyphs } from './item-glyphs.js'
import { WorkGlyphs } from './work-glyphs.js'
import type { BacklogKind, BacklogStatus } from './item.js'

// DESIGN.md › Colour roles: a page's own vocabulary is not a work status and takes no status hue.
const STATUSES: readonly BacklogStatus[] = ['inbox', 'todo', 'doing', 'done', 'dropped']
const KINDS: readonly BacklogKind[] = ['task', 'bug', 'idea', 'note', 'question']
const STATUS_HUE = /\b(?:text|bg|fill|stroke|border)-(?:destructive|success|warning|info)\b/u

test('status and kind glyphs are ink or muted, never a status hue', () => {
  for (const status of STATUSES) {
    expect(renderToStaticMarkup(<ItemGlyphs.StatusIcon status={status} />), status).not.toMatch(STATUS_HUE)
  }
  for (const kind of KINDS) {
    expect(renderToStaticMarkup(<ItemGlyphs.KindIcon kind={kind} />), kind).not.toMatch(STATUS_HUE)
  }
  expect(renderToStaticMarkup(<WorkGlyphs.PriorityIcon priority="urgent" />)).not.toMatch(STATUS_HUE)
})

test('Dropped is a ring with one diagonal stroke, not the Failed cross', () => {
  const markup = renderToStaticMarkup(<ItemGlyphs.StatusIcon status="dropped" />)
  const strokes = [...markup.matchAll(/<path d="([^"]+)"/gu)].map(match => match[1] ?? '')
  expect(strokes).toHaveLength(1)
  // One move, one line: a cross needs a second `m`/`M`.
  expect(strokes[0]?.match(/[mM]/gu)).toHaveLength(1)
})

test('the user avatar is drawn with an identity tone', () => {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <ItemGlyphs.ActorAvatar actorId="user" />
    </TooltipProvider>,
  )
  expect(markup).toMatch(/identity-\d/u)
  expect(markup).not.toMatch(STATUS_HUE)
})

test('status groups with no items are not drawn', () => {
  const view = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'items-view.tsx'), 'utf8')
  expect(view).toContain('const visibleGroups = groups.filter(group => group.items.length > 0)')
})

test('status glyphs are ink rings, not the to-do square that read as a checkbox (council round 10, D3)', () => {
  // An open item (Inbox, Todo) is an open 16 px ring edged 1.5 px in ink; In progress adds a half-disc, Done a check.
  for (const status of ['inbox', 'todo', 'doing', 'done'] as const) {
    const markup = renderToStaticMarkup(<ItemGlyphs.StatusIcon status={status} />)
    expect(markup, status).toMatch(/<svg[^>]*width="16" height="16"/u)
    expect(markup, status).toContain('dshx:size-4')
    expect(markup, status).toMatch(/<circle [^>]*stroke-width="1.5"/u)
    expect(markup, status).not.toContain('<rect')
    expect(markup, status).not.toContain('stroke-dasharray')
    expect(markup, status).toContain('dshx:text-foreground')
  }
  expect(renderToStaticMarkup(<ItemGlyphs.StatusIcon status="doing" />)).toMatch(/<path d="M8 [^"]*a3\.5 3\.5 [^"]*" fill="currentColor"/u)
  expect(renderToStaticMarkup(<ItemGlyphs.StatusIcon status="done" />)).toMatch(/<path d="m[^"]*" fill="none" stroke="currentColor"/u)
  for (const status of ['inbox', 'todo', 'doing'] as const) {
    const stale = renderToStaticMarkup(<ItemGlyphs.StatusIcon status={status} stale />)
    expect(stale, status).toContain('stroke-dasharray')
    expect(stale, status).toContain('dshx:text-muted-foreground')
  }
  expect(ItemGlyphs.isStale('stale')).toBe(true)
  expect(ItemGlyphs.isStale('dormant')).toBe(true)
  expect(ItemGlyphs.isStale('fresh')).toBe(false)
  const feed = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'feed-view.tsx'), 'utf8')
  expect(feed).toContain('stale={ItemGlyphs.isStale(item.freshness)}')
})
