import { describe, expect, it } from 'vitest'

import { activityPhrase } from './activity-phrase.js'

describe('activity line phrases', () => {
  it('reads an attention signal with the reason it fired', () => {
    expect(activityPhrase({ kind: 'edited', detail: 'attention: none (the thread’s question was answered)', actor: 'agent:session-abc' }, 'none')).toBe(
      'cleared the request (the thread’s question was answered)',
    )
    expect(activityPhrase({ kind: 'edited', detail: 'attention: blocked (the thread stopped on a block)', actor: 'system' }, 'blocked')).toBe(
      'flagged it blocked (the thread stopped on a block)',
    )
  })

  it('keeps a legacy attention edit and a plain edit readable', () => {
    expect(activityPhrase({ kind: 'edited', detail: 'attention', actor: 'agent:session-abc' }, 'needs-input')).toBe('asked for your input')
    expect(activityPhrase({ kind: 'edited', detail: 'tags, title', actor: 'agent:session-abc' }, 'none')).toBe('edited tags, title')
  })
})
