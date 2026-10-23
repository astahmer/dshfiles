import { describe, expect, it } from 'vitest'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { detachedFlow, detachedView } from './detached-injected.ts'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'

const policy: ChatPresentationPolicy = {
  mode: 'standard',
  collapseTiming: 'completion',
  foldCompletedTurns: true,
  stepGrouping: 'collapsed',
  liveProcessDetail: false,
  settledReasoningPreview: true,
}

const presentation: ObservableSnapshot<ChatPresentationPolicy> = {
  getSnapshot: () => policy,
  subscribe: () => () => {},
}

describe('detached Chat injection', () => {
  it('resolves empty node sources instead of throwing for a session without a binding', () => {
    const flow = detachedFlow(presentation)
    expect(flow.keyedHooks.chatNode('missing').getSnapshot()).toBeUndefined()
    expect(flow.keyedHooks.chatNodeBottom('missing').getSnapshot()).toBe(false)
    expect(flow.keyedHooks.chatNodeProcess('missing').getSnapshot()).toBeUndefined()
    expect(flow.keyedHooks.chatGroup('missing')).toBeUndefined()
  })

  it('keeps every view action inert so a gap renders nothing and never throws', async () => {
    const view = detachedView(presentation)
    expect(() => {
      view.openExternalLink('https://example.invalid')
      view.loadOlder()
      view.forkAt(1)
      view.chatScroll.save(null)
    }).not.toThrow()
    expect(view.chatScroll.read()).toBeNull()
    expect(view.fileMentions({} as never)).toBeUndefined()
    await expect(view.openFile('/tmp/none')).resolves.toBeUndefined()
    await expect(view.loadThrough(SessionSeq(1))).resolves.toBeUndefined()
    await expect(view.loadImage({} as never)).resolves.toBe('')
  })
})
