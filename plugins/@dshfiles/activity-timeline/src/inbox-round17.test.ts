import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('./inbox-locales.ts', import.meta.url), 'utf8')

/** The JSX of the element opened before `marker`, up to its closing tag. */
const element = (marker: string, tag: string): string => {
  const at = panel.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  return panel.slice(panel.lastIndexOf(`<${tag}`, at), panel.indexOf(`</${tag}>`, at))
}

describe('one Inbox card body measure (council round 17 C1)', () => {
  it('sets the well, the prose and the answers on one width in rem, never a font-relative ch', () => {
    // 72ch in the well's mono 12px, the prose's sans 14px and the answer row's own width drew three right edges.
    expect(InboxView.TEXT_MEASURE).toBe('dshx:max-w-xl')
    expect(InboxView.TEXT_MEASURE).not.toMatch(/ch\]/u)
    expect(element('data-inbox-runs=""', 'EvidenceWell')).toContain('className={InboxView.TEXT_MEASURE}')
    expect(element('data-inbox-failure-well={failure.kind}', 'EvidenceWell')).toContain('className={InboxView.TEXT_MEASURE}')
    expect(panel.match(/'dshx:break-words', InboxView\.TEXT_MEASURE\)/gu)).toHaveLength(1)
    expect(panel).toContain("answerable && 'dshx:text-xs dshx:text-muted-foreground', InboxView.TEXT_MEASURE)")
    // The answers row measures its content box, so its inset stays outside the measure, as the evidence's does.
    expect(InboxView.ANSWERS_MEASURE).toBe(`dshx:box-content ${InboxView.TEXT_MEASURE}`)
    expect(panel).toContain('className={cn(InboxView.ANSWERS, InboxView.ANSWERS_MEASURE, InboxView.BODY_INSET)}')
  })

  it('says what the page is for in one plain sentence', () => {
    expect(locales).toContain("subtitle: 'Review approvals, answer questions, and inspect failures.',")
    expect(locales).not.toContain('Everything that needs you, in one place.')
    expect(locales).toContain("subtitle: '审阅批准、回答问题、检查失败。',")
  })
})
