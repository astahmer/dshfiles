import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it } from 'vitest'
import { InputTriggerController, type SourceRoster } from '../src/client/controller.js'
import type { InputTriggerSource } from '../src/types.js'

it('warms trigger sources on the first typed draft, not when a thread opens', () => {
  const warmed: string[] = []
  const skills: InputTriggerSource = {
    name: 'skills',
    trigger: '/',
    candidates: async () => [],
    onPick: () => undefined,
    warm: () => {
      warmed.push('skills')
    },
  }
  const roster: SourceRoster = { sources: trigger => [skills].filter(item => item.trigger === trigger), all: () => [skills] }
  const controller = new InputTriggerController({ actx: new Context(), sessionId: SessionId('session-1'), roster })
  expect(warmed).toEqual([])

  controller.track('', 0, { tier: 'plain' }, 1)
  expect(warmed).toEqual([])

  controller.track('h', 1, { tier: 'plain' }, 2)
  controller.track('hi', 2, { tier: 'plain' }, 3)
  expect(warmed).toEqual(['skills'])
})
