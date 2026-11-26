import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FeedLook } from './feed-look.js'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Backlog feed (round five P6)', () => {
  const feed = read('feed-view.tsx')

  it('draws item titles in foreground ink at 14/20, weight 500, through the compact Markdown root', () => {
    // The native compact Markdown root sets its own 13 px tertiary text, so the wrapper's classes never reached it.
    const title = feed.slice(feed.indexOf('text={imageTitleFallback(item.title)}'), feed.indexOf('<FeedEntryAuthor'))
    for (const utility of ['dshx:[&>div>div]:text-foreground!', 'dshx:[&>div>div]:text-base!', 'dshx:[&>div>div]:leading-5!', 'dshx:font-medium'])
      expect(title).toContain(utility)
  })

  it('hides the author avatar when every row shares the author', () => {
    const own = { actors: [{ id: 'user', role: 'owner' as const }] }
    expect(FeedLook.authorsDiffer([own, own])).toBe(false)
    expect(FeedLook.authorsDiffer([own, { actors: [{ id: 'agent:1', role: 'owner' as const }] }])).toBe(true)
    expect(feed).toMatch(/props\.showAuthor \? <ItemGlyphs\.ActorAvatar/u)
  })

  it('tints each tag in a status-safe identity tone that stays the same for the same tag', () => {
    expect(FeedLook.tagTone('billing')).toBe(FeedLook.tagTone('billing'))
    expect(new Set(['billing', 'finance', 'web-app', 'a11y', 'docs'].map(FeedLook.tagTone)).size).toBeGreaterThan(2)
    for (const tag of ['billing', 'docs']) expect(FeedLook.tagTone(tag)).toMatch(/^project-tone-balanced-[0-5]$/u)
    expect(feed).toMatch(
      /<span key=\{tag\} className=\{cn\(FeedLook\.TAG_CHIP, props\.tagTone\(tag\)\)\}>\s*<span className="dshx-project-mark-letters">#\{tag\}<\/span>/u,
    )
    expect(FeedLook.TAG_CHIP).toContain('dshx:bg-current/14')
    expect(FeedLook.TAG_CHIP).not.toMatch(/text-muted|border/u)
  })

  it('lets the feed card hug its rows and starts the capture box at one 44 px line', () => {
    expect(read('backlog-panel.tsx')).toMatch(/hugsContent && 'dshx:flex-initial'/u)
    const composer = read('composer.tsx')
    expect(composer).not.toContain('dshx:min-h-20')
    expect(composer).toContain("chat ? 'dshx:min-h-11 dshx:max-h-72 dshx:text-sm'")
  })
})

describe('Backlog feed (council round 2, D2)', () => {
  const feed = read('feed-view.tsx')
  const panel = read('backlog-panel.tsx')
  const composer = read('composer.tsx')

  it('shows the capture box as one 44 px line with a placeholder until it is used', () => {
    expect(panel).toContain('placeholder="Capture a task, bug or idea…"')
    // Idle: no text, no file, no focus, nothing open. The toolbar row appears once the box is used.
    expect(composer).toMatch(/const idle =\s*chat &&\s*!engaged &&\s*text\.trim\(\) === '' &&\s*attachments\.files\.length === 0 &&/u)
    expect(composer).toContain("idle ? 'dshx:h-11 dshx:justify-center dshx:px-3 dshx:py-0'")
    // The editor's Enter can leave blank lines after a send; they are cleared, so the box goes back to idle.
    expect(composer).toMatch(/input\.current\.getText\(\)\.trim\(\) === ''[^\n]*\n\s*input\.current\.replaceText\(''\)/u)
    expect(composer).toContain("if (engaged || text === '' || text.trim() !== '') return")
    expect(composer).toMatch(/data-capture-toolbar=""[^>]*className=\{cn\([^)]*idle && 'dshx:hidden'/su)
  })

  it('lines the capture box and the feed up with the page edges instead of a centred column', () => {
    expect(panel).not.toContain('dshx:mx-auto dshx:max-w-4xl')
    expect(feed).not.toContain('dshx:mx-auto dshx:flex dshx:min-h-full dshx:max-w-4xl')
  })

  it('lays each row on one grid: 52 px time gutter, 16 px status, title, author, with tags 4 px under the title', () => {
    expect(feed).toContain(
      'dshx:grid dshx:min-w-0 dshx:flex-1 dshx:grid-cols-[52px_32px_minmax(0,1fr)_auto] dshx:content-center dshx:items-center dshx:gap-x-2.5 dshx:gap-y-1',
    )
    expect(feed).toMatch(/data-feed-entry-chips="" className="dshx:col-span-2 dshx:col-start-3/u)
  })

  it('folds the status row into the Filter menu', () => {
    expect(feed).not.toContain('<StatusFilterBar')
    expect(read('backlog-toolbar.tsx')).toMatch(/DropdownMenuLabel[^>]*>Status<\/DropdownMenuLabel>/u)
    expect(panel).toMatch(/status=\{\s*view === 'feed'/u)
  })
})

describe('Backlog feed (council round 3, D2)', () => {
  const feed = read('feed-view.tsx')
  const bare = { attention: 'none' as const, proposal: null, project: null, attachments: [], links: [], activity: { comments: 0 }, freshness: 'fresh' as const }

  // Council round 4, D4: one fixed hue per tag. Collisions are accepted; a tag never changes colour as others come and go.
  it('gives each tag one fixed tone, whatever other tags are on screen', () => {
    expect(FeedLook).not.toHaveProperty('tagTones')
    expect(feed).not.toContain('tagTones')
    expect(feed).toMatch(/tagTone=\{FeedLook\.tagTone\}/u)
  })

  it("prints one time per run of consecutive same-minute rows, on the run's first row (council round 5, D4)", () => {
    const times = ['08:41', '08:41', '08:41', '08:42', '08:42', '08:41']
    expect(times.map((_, index) => FeedLook.timeShownAbove(times, index))).toEqual([false, true, true, false, true, false])
    expect(FeedLook).not.toHaveProperty('sharedTime')
    expect(feed).not.toContain('sharedTimes')
    expect(feed).toMatch(/timeShownAbove=\{/u)
  })

  it('start-aligns the day divider with the rows: its label first, one rule after it (council round 5, D4)', () => {
    const divider = /<div role="separator" className="([^"]*)">([\s\S]*?)<\/div>/u.exec(feed)
    expect(divider?.[1]).toContain('dshx:px-2')
    const body = divider?.[2] ?? ''
    expect(body.match(/dshx:h-px dshx:flex-1 dshx:bg-border/gu)).toHaveLength(1)
    expect(body.indexOf('{label}')).toBeLessThan(body.indexOf('dshx:h-px'))
  })

  it('puts one short tag inline with the title, and keeps a second line for previews or several chips', () => {
    expect(FeedLook.inlineTag({ ...bare, tags: ['billing'] })).toBe('billing')
    expect(FeedLook.inlineTag({ ...bare, tags: ['billing', 'docs'] })).toBeNull()
    expect(FeedLook.inlineTag({ ...bare, tags: ['a-very-long-tag-name-here'] })).toBeNull()
    expect(FeedLook.inlineTag({ ...bare, tags: ['billing'], attention: 'blocked' })).toBeNull()
    expect(FeedLook.inlineTag({ ...bare, tags: ['billing'], links: [{}] })).toBeNull()
    expect(feed).toMatch(/const inlineTag = FeedLook\.inlineTag\(item\)/u)
  })

  it('gives a one-line row 44 px, its line centred; a two-line row grows from there', () => {
    // A 44 px floor rather than padding alone: the title line height follows the density scale.
    expect(feed).toContain('dshx:min-h-[44px] dshx:rounded-lg dshx:px-2 dshx:py-[10px] dshx:transition-colors')
    expect(feed).toContain('dshx:grid-cols-[52px_32px_minmax(0,1fr)_auto] dshx:content-center')
  })
})

describe('Backlog feed lane (council round 3, D2)', () => {
  const panel = read('backlog-panel.tsx')
  it('holds the page (header, toolbar, feed and capture box) to the kit lane (880 px of content, 960 px on wide panes); the board runs full width', () => {
    expect(panel).toMatch(/<Page\s+fill\s+(?:\/\/[^\n]*\n\s*)*width=\{view === 'board' \? 'full' : 'lane'\}/u)
    expect(panel).not.toContain('920 px')
  })
})

describe('Backlog feed times (council round 6, D3)', () => {
  const feed = read('feed-view.tsx')
  it('sets each time as an 11 px tabular run label in a stable leading gutter, before the status seat', () => {
    const row = feed.slice(feed.indexOf('dshx:grid-cols-[52px_32px_minmax(0,1fr)_auto]'), feed.indexOf('<ItemPickers.Status'))
    expect(row).toContain('<FeedEntryTime item={item} timeShownAbove={props.timeShownAbove} />')
    const gutter = /data-feed-entry-gutter=""\s*className="([^"]*)"/u.exec(feed)?.[1] ?? ''
    for (const look of ['dshx:text-2xs', 'dshx:tabular-nums', 'dshx:whitespace-nowrap']) expect(gutter).toContain(look)
    // No trailing time any more: the meta column holds only the author, and only when rows differ.
    expect(feed).toMatch(/\{props\.showAuthor \? <FeedEntryAuthor author=\{author\} \/> : null\}/u)
  })
})

describe('Backlog page title mark (council round 7, D1)', () => {
  it('marks the h1 with the Work destination glyph in its nav tone', () => {
    const panel = read('backlog-panel.tsx')
    const page = panel.slice(panel.indexOf('<Page'), panel.indexOf('heading="Backlog"'))
    expect(page).toContain('mark={<ListTodoIcon />}')
    expect(page).toContain('markTone="work"')
  })
})

describe('Backlog feed time groups (council round 8, D2)', () => {
  it('opens each new time group with 8 px more space; a day divider already opens its own', () => {
    const times = ['1:07 AM', '1:07 AM', '1:08 AM', '1:08 AM', '1:09 AM']
    expect([0, 1, 2, 3, 4].map(index => FeedLook.startsTimeGroup(times, index, index === 0))).toEqual([false, false, true, false, true])
    // The first row after a day divider starts a group, but the divider's own margin is the gap.
    expect(FeedLook.startsTimeGroup(times, 2, true)).toBe(false)
    const view = read('feed-view.tsx')
    expect(view).toContain("FeedLook.startsTimeGroup(times, index, separator) && 'dshx:mt-2'")
  })
})

describe('Backlog capture field (council round 12, D2)', () => {
  it("draws the fields' 3:1 edge at rest, so the capture box reads as a place to type", () => {
    const composer = read('composer.tsx')
    expect(composer).toContain("failed === null ? 'dshx:border-field-border' : 'dshx:border-destructive/60'")
    expect(composer).toContain('dshx:focus-within:border-ring')
    expect(composer).not.toContain('dshx:focus-within:border-input')
  })
})
