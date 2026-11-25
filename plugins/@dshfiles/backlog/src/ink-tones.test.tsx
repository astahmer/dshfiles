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
