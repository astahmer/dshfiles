import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { InputTriggerController, type SourceRoster } from '../src/client/controller.js'
import type { InputTriggerSource } from '../src/types.js'

const claimOf = (name: string) => ({ name, token: `/${name} `, submit: async () => ({ kind: 'success' }) as const })

const source = (over: Partial<InputTriggerSource> & Pick<InputTriggerSource, 'name'>): InputTriggerSource => ({
  trigger: '/',
  candidates: async () => [],
  onPick: () => undefined,
  ...over,
})

const controllerFor = (sources: readonly InputTriggerSource[]): InputTriggerController => {
  const roster: SourceRoster = { sources: trigger => sources.filter(item => item.trigger === trigger), all: () => sources }
  return new InputTriggerController({ actx: new Context(), sessionId: SessionId('session-1'), roster })
}

describe('persisted command chip restore', () => {
  it('claims the token through the first source that answers', async () => {
    const silent = source({ name: 'silent', matchClaim: async () => undefined })
    const claiming = source({ name: 'btw', matchClaim: async () => claimOf('btw') })
    const never = source({ name: 'never', matchClaim: async () => claimOf('never') })
    const controller = controllerFor([silent, claiming, never])

    expect(await controller.resolveClaim('/btw', new AbortController().signal)).toMatchObject({ name: 'btw' })
  })

  it('skips sources without the hook, claimed by another trigger, and a claimless poll', async () => {
    const asked: string[] = []
    const atSource = source({ name: 'at', trigger: '@', matchClaim: async () => undefined })
    const bare = source({ name: 'bare' })
    const slash = source({
      name: 'slash',
      matchClaim: async (_session, token) => {
        asked.push(token)
        return undefined
      },
    })
    const controller = controllerFor([atSource, bare, slash])

    expect(await controller.resolveClaim('/unknown', new AbortController().signal)).toBeUndefined()
    expect(asked).toEqual(['/unknown'])
  })

  it('rejects an already-aborted restore without polling a source', async () => {
    let polled = false
    const sourcing = source({
      name: 'btw',
      matchClaim: async () => {
        polled = true
        return claimOf('btw')
      },
    })
    const controller = controllerFor([sourcing])
    const aborted = new AbortController()
    aborted.abort(new Error('restore cancelled'))

    await expect(controller.resolveClaim('/btw', aborted.signal)).rejects.toThrow('restore cancelled')
    expect(polled).toBe(false)
  })
})
