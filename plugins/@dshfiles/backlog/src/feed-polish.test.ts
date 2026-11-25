import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FeedLook } from './feed-look.js'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Backlog feed (round five P6)', () => {
  const feed = read('feed-view.tsx')

  it('draws item titles in foreground ink at 14/20, weight 500, through the compact Markdown root', () => {
    // The native compact Markdown root sets its own 13 px tertiary text, so the wrapper's classes never reached it.
    const title = feed.slice(feed.indexOf('text={imageTitleFallback(item.title)}'), feed.indexOf('<FeedEntryMeta'))
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

  it('lays each row on one grid: 16 px status, title, 104 px meta, with tags 4 px under the title', () => {
    expect(feed).toContain('dshx:grid dshx:min-w-0 dshx:flex-1 dshx:grid-cols-[16px_minmax(0,1fr)_104px] dshx:content-center dshx:items-center dshx:gap-x-2.5 dshx:gap-y-1')
    expect(feed).toMatch(/data-feed-entry-chips="" className="dshx:col-span-2 dshx:col-start-2/u)
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

  it('gives the tags on one screen distinct tones, never two neighbouring hues (#docs and #finance were both teal)', () => {
    const tones = FeedLook.tagTones(['billing', 'finance', 'web-app', 'a11y', 'docs', 'billing'])
    expect(tones.get('docs')).not.toBe(tones.get('finance'))
    expect(new Set(tones.values()).size).toBe(5)
    // Tones 0/5 (225°/195°) and 3/4 (305°/340°) read as one colour: no pair of them while a far tone is free.
    const four = FeedLook.tagTones(['docs', 'finance', 'billing', 'a11y'])
    const indices = [...four.values()].map(tone => Number(tone.at(-1)))
    expect(indices.includes(0) && indices.includes(5)).toBe(false)
    expect(indices.includes(3) && indices.includes(4)).toBe(false)
    // Stable: the same set gives the same tones whatever the order of the rows.
    expect(FeedLook.tagTones(['docs', 'finance'])).toEqual(FeedLook.tagTones(['finance', 'docs']))
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
    expect(feed).toContain('dshx:grid-cols-[16px_minmax(0,1fr)_104px] dshx:content-center')
  })
})

describe('Backlog feed lane (council round 3, D2)', () => {
  const panel = read('backlog-panel.tsx')
  it('holds the page (header, toolbar, feed and capture box) to the kit lane (920 px); the board runs full width', () => {
    expect(panel).toMatch(/<Page\s+fill\s+(?:\/\/[^\n]*\n\s*)?width=\{view === 'board' \? 'full' : 'lane'\}/u)
  })
})
