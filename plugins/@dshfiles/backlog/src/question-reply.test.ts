import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import { describe, expect, it } from 'vitest'

import { BacklogQuestionReply } from './question-reply.js'

describe('answered question messages', () => {
  it('recognises the reply an answered question steers back into the Agent', () => {
    expect(BacklogQuestionReply.isAnswer({ kind: 'user-question-reply', callId: ToolCallId('call_1'), outcome: 'answered' })).toBe(true)
  })

  it('leaves a typed prompt alone', () => {
    expect(BacklogQuestionReply.isAnswer({ kind: 'user' })).toBe(false)
  })
})
