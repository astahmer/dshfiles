import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))

const approval = {
  source: 'thread-sidebar.approval',
  reason: 'Approve: Publish the preview build',
  detail: 'node scripts/publish-preview.mjs --env preview',
}

describe('an Inbox card (round five C3, council round 4)', () => {
  it('keeps the card menu in the head band on every width, not on the row of verbs', () => {
    // Round five C4 (council round 5): the menu ends the head row's trailing seat at every width.
    expect(row).toMatch(/trailing=\{\(props\.actionRow === false && !compact\) \|\| \(footed && !hasMenu\) \? undefined : headVerbs\}/u)
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-1.5')
    expect(row).toContain('InboxView.CARD_HEAD')
  })

  it('says an approval title once: no "Approve: <title>" line under the band', () => {
    const text = InboxView.cardText(approval, 'Publish preview build')
    expect(text.reason).toBeNull()
    expect(text.detail).toBe('node scripts/publish-preview.mjs --env preview')
    expect(text.command).toBe(true)
  })

  it('keeps what an approval asks when it says more than the title, without the "Approve:" lead-in', () => {
    const text = InboxView.cardText({ ...approval, reason: 'Approve: Clear the cache and force-push main' }, 'Fix the router')
    expect(text.reason).toBe('Clear the cache and force-push main')
  })

  it('leaves other items as they read', () => {
    const question = InboxView.cardText({ source: 'agent-questions.native-question', reason: 'Asks: Which rate?', detail: null }, 'Reconcile')
    expect(question).toEqual({ reason: 'Asks: Which rate?', detail: null, command: false })
  })

  // Council round 16 C3: the command sits in the kit evidence well (inbox-round16.test.ts).
  it('draws an approval command as a command in the evidence well', () => {
    expect(row).toContain('<code className={InboxView.WELL_CODE}>')
  })

  it('titles a card at the contextual heading step, 15/20 at 600', () => {
    // Council round 18 C1: two lines at most on a phone (inbox-round18.test.ts).
    expect(InboxView.TITLE).toBe('dshx:text-heading dshx:@max-pane-narrow:line-clamp-2')
    expect(row).toMatch(/heading=\{<span className=\{InboxView\.TITLE\}>\{title\}<\/span>\}/u)
  })

  it('folds a bodyless Failed item into one title-and-recovery row', () => {
    expect(InboxView.compact('failed', { reason: null, detail: null })).toBe(true)
    expect(InboxView.compact('failed', { reason: 'Turn failed: HTTP 529', detail: null })).toBe(false)
    expect(InboxView.compact('needs-you', { reason: null, detail: null })).toBe(false)
    // The recovery verbs ride the band's trailing seat instead of a row of their own under an empty body (every card's
    // verbs did since round five C4, a bodyless card's still do since council round 8 C2; triage keeps a compact card's).
    expect(row).toMatch(/trailing=\{\(props\.actionRow === false && !compact\) \|\| \(footed && !hasMenu\) \? undefined : headVerbs\}/u)
    expect(row).toMatch(/\{props\.actionRow === false \? null : answers\}/u)
  })
})
