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
    expect(feed).toMatch(/<span key=\{tag\} className=\{cn\(FeedLook\.TAG_CHIP, FeedLook\.tagTone\(tag\)\)\}>\s*<span className="dshx-project-mark-letters">#\{tag\}<\/span>/u)
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
