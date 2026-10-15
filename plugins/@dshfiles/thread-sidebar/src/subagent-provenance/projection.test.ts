import { describe, expect, it } from 'vitest'
import { routeLabelFromAssistantEvent } from './projection.js'

describe('thread-sidebar model-route projection', () => {
  it('reads only safe provider/model fields from assistant message events', () => {
    expect(
      routeLabelFromAssistantEvent({
        type: 'assistant/message',
        data: {
          message: {
            source: {
              kind: 'model',
              provider: 'openai',
              model: 'gpt-6.1-luna',
              replayState: { credential: 'not for projection' },
            },
            content: [{ type: 'text', text: 'private assistant output' }],
          },
        },
      }),
    ).toBe('openai/gpt-6.1-luna')
  })

  it('clears unsafe routes and ignores unrelated or malformed events', () => {
    expect(
      routeLabelFromAssistantEvent({
        type: 'assistant/message',
        data: { message: { source: { provider: 'alex@example.com', model: 'gpt-6.1-luna' } } },
      }),
    ).toBeNull()
    expect(routeLabelFromAssistantEvent({ type: 'request/header', data: {} })).toBeUndefined()
    expect(routeLabelFromAssistantEvent({ type: 'assistant/message', data: { message: {} } })).toBeUndefined()
  })
})
