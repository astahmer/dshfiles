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
      /<span key=\{tag\} className=\{cn\(FeedLook\.TAG_CHIP, FeedLook\.tagTone\(tag\)\)\}>\s*<span className="dshx-project-mark-letters">#\{tag\}<\/span>/u,
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
    expect(feed).toContain('dshx:grid dshx:min-w-0 dshx:flex-1 dshx:grid-cols-[16px_minmax(0,1fr)_104px] dshx:items-center dshx:gap-x-2.5 dshx:gap-y-1')
    expect(feed).toMatch(/data-feed-entry-chips="" className="dshx:col-span-2 dshx:col-start-2/u)
  })

  it('folds the status row into the Filter menu', () => {
    expect(feed).not.toContain('<StatusFilterBar')
    expect(read('backlog-toolbar.tsx')).toMatch(/DropdownMenuLabel[^>]*>Status<\/DropdownMenuLabel>/u)
    expect(panel).toMatch(/status=\{\s*view === 'feed'/u)
  })
})
