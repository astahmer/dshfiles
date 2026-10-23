import { describe, expect, it } from 'vitest'
import type { TriggerGuard } from '../src/types.js'
import { detectTrigger } from '../src/core/detect.js'

const plain: TriggerGuard = { tier: 'plain' }

const detect = (draft: string, caret = draft.length, tier: TriggerGuard = plain) => detectTrigger(draft, caret, tier)

describe('shared input trigger detection', () => {
  it('detects the unquoted @ token at the caret', () => {
    const draft = 'Find @deploy'

    expect(detect(draft)).toMatchObject({
      trigger: '@',
      query: 'deploy',
      quoted: false,
      position: 'inline',
      span: { start: 5, end: draft.length, draftRev: 0 },
    })
  })

  it('spans the whole token when the caret is inside it', () => {
    expect(detect('@deploy later', '@dep'.length)).toMatchObject({
      query: 'deploy',
      position: 'leading',
      span: { start: 0, end: '@deploy'.length },
    })
  })

  it('does not keep an unquoted @ query open past whitespace', () => {
    expect(detect('Find @fix the deploy script')).toBeNull()
    expect(detect('we should be able to @ stuff etc also')).toBeNull()
    expect(detect('@dsh trying to select it')).toBeNull()
    expect(detect('@a thread title ')).toBeNull()
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

  it('keeps colons inside the active mention token', () => {
    expect(detect('@session:session-example')).toMatchObject({
      trigger: '@',
      query: 'session:session-example',
      quoted: false,
    })
  })

  it('does not let an @ token reach across a newline', () => {
    expect(detect('@fix\ndeploy')).toBeNull()
  })

  it('does not treat an email address as an @ query', () => {
    expect(detect('Contact user@example.com about this')).toBeNull()
    expect(detect('Contact user@example.com')).toBeNull()
  })

  it('preserves slash-command detection and guard behavior', () => {
    expect(detect('/deploy')).toMatchObject({ trigger: '/', query: 'deploy', quoted: false })
    expect(detect('/deploy', '/deploy'.length, { tier: 'claimed' })).toBeNull()
  })
})
