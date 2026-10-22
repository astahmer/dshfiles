import { describe, expect, it } from 'vitest'
import type { TriggerGuard } from '../src/types.js'
import { detectTrigger } from '../src/core/detect.js'

const plain: TriggerGuard = { tier: 'plain' }

const detect = (draft: string, caret = draft.length, tier: TriggerGuard = plain) => detectTrigger(draft, caret, tier)

describe('shared input trigger detection', () => {
  it('keeps an unquoted multiword @ query active through the caret', () => {
    const draft = 'Find @fix the deploy script'
    const at = draft.indexOf('@')

    expect(detect(draft)).toMatchObject({
      trigger: '@',
      query: 'fix the deploy script',
      quoted: false,
      position: 'inline',
      span: { start: at, end: draft.length, draftRev: 0 },
    })
  })

  it('uses the caret, not trailing draft text, for a multiword span', () => {
    const draft = '@deploy script later'
    const caret = '@deploy scr'.length

    expect(detect(draft, caret)).toMatchObject({
      query: 'deploy scr',
      span: { start: 0, end: caret },
    })
  })

  it('keeps quoted multiword @ queries supported', () => {
    const draft = '@"fix the deploy'

    expect(detect(draft)).toMatchObject({
      trigger: '@',
      query: 'fix the deploy',
      quoted: true,
      span: { start: 0, end: draft.length },
    })
  })

  it('targets the token at the caret instead of a preceding @ query', () => {
    expect(detect('Follow-up after @session:session-example :')).toBeNull()
    expect(detect('Follow-up after @session:session-example !')).toBeNull()
  })

  it('keeps multiword title search active while the caret is in its final word', () => {
    expect(detect('Find @a thread title')).toMatchObject({
      trigger: '@',
      query: 'a thread title',
      quoted: false,
    })
  })

  it('keeps colons inside the active mention token', () => {
    expect(detect('@session:session-example')).toMatchObject({
      trigger: '@',
      query: 'session:session-example',
      quoted: false,
    })
  })

  it('does not keep a query active after its trailing separator whitespace', () => {
    expect(detect('@a thread title ')).toBeNull()
  })

  it('does not let an unquoted query cross a newline', () => {
    expect(detect('@fix the\ndeploy script')).toBeNull()
  })

  it('does not treat an email address as an @ query', () => {
    expect(detect('Contact user@example.com about this')).toBeNull()
  })

  it('preserves slash-command detection and guard behavior', () => {
    expect(detect('/deploy')).toMatchObject({ trigger: '/', query: 'deploy', quoted: false })
    expect(detect('/deploy', '/deploy'.length, { tier: 'claimed' })).toBeNull()
  })
})
