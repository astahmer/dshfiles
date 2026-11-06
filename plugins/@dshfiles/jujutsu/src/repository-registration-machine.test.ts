import { createActor, waitFor, type InputFrom } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { repositoryRegistrationMachine, type RegisteredRepository } from './repository-registration-machine.js'

type Client = InputFrom<typeof repositoryRegistrationMachine>['client']

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const registered = (repoId: string, root: string): RegisteredRepository => ({ repoId, root })

const startRegistration = (register: Client['register'], path: string | null = null) => {
  const actor = createActor(repositoryRegistrationMachine, { input: { client: { register }, path } })
  const emitted: RegisteredRepository[] = []
  actor.on('registered', event => emitted.push(event.repo))
  actor.start()
  return { actor, emitted }
}

describe('repositoryRegistrationMachine', () => {
  it('supersedes a slow registration so its late result never becomes the active repository', async () => {
    const slow = deferred<RegisteredRepository>()
    const fast = deferred<RegisteredRepository>()
    const { actor, emitted } = startRegistration(async ({ path }) => (path === '/work/old' ? slow.promise : fast.promise))

    actor.send({ type: 'register', path: '/work/old' })
    expect(actor.getSnapshot().matches('registering')).toBe(true)
    actor.send({ type: 'register', path: '/work/new' })

    fast.resolve(registered('new-id', '/work/new'))
    await waitFor(actor, snapshot => snapshot.context.repoId === 'new-id')
    slow.resolve(registered('old-id', '/work/old'))
    await slow.promise
    await Promise.resolve()

    expect(actor.getSnapshot().context.repoId).toBe('new-id')
    expect(actor.getSnapshot().context.path).toBe('/work/new')
    expect(emitted).toEqual([registered('new-id', '/work/new')])
    actor.stop()
  })

  it('re-registers read-only once per path after the Host loses the id, until the state loads', async () => {
    const requests: { readonly path: string; readonly readOnly: boolean }[] = []
    const { actor } = startRegistration(async request => {
      requests.push(request)
      return request.readOnly ? registered('recovered-id', request.path) : registered('fresh-id', request.path)
    })

    actor.send({ type: 'register', path: '/work/project' })
    await waitFor(actor, snapshot => snapshot.matches('registered'))
    expect(actor.getSnapshot().context.repoId).toBe('fresh-id')

    actor.send({ type: 'recover', path: '/work/project' })
    await waitFor(actor, snapshot => snapshot.context.repoId === 'recovered-id')
    actor.send({ type: 'recover', path: '/work/project' })

    expect(requests).toEqual([
      { path: '/work/project', readOnly: false },
      { path: '/work/project', readOnly: true },
    ])

    actor.send({ type: 'state.loaded' })
    expect(actor.getSnapshot().context.recoveredPath).toBeNull()
    actor.stop()
  })

  it('ignores a second registration for the path already in flight', async () => {
    let calls = 0
    const pending = deferred<RegisteredRepository>()
    const { actor } = startRegistration(async () => {
      calls += 1
      return pending.promise
    })

    actor.send({ type: 'register', path: '/work/project' })
    actor.send({ type: 'register', path: '/work/project' })
    expect(calls).toBe(1)
    actor.stop()
  })

  it('keeps a failure in the machine and retries the same path', async () => {
    let calls = 0
    const { actor, emitted } = startRegistration(async ({ path }) => {
      calls += 1
      if (calls === 1) throw new Error('Not a Jujutsu repository.')
      return registered('repo-id', path)
    })

    actor.send({ type: 'register', path: '/work/project' })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.error).toBe('Not a Jujutsu repository.')
    expect(emitted).toEqual([])

    actor.send({ type: 'register', path: '/work/project' })
    await waitFor(actor, snapshot => snapshot.matches('registered'))
    expect(actor.getSnapshot().context.error).toBeNull()
    expect(emitted).toEqual([registered('repo-id', '/work/project')])
    actor.stop()
  })

  it('never registers an empty path', () => {
    let calls = 0
    const { actor } = startRegistration(async () => {
      calls += 1
      return registered('repo-id', '/work/project')
    })

    actor.send({ type: 'register', path: '   ' })
    expect(calls).toBe(0)
    expect(actor.getSnapshot().matches('unregistered')).toBe(true)
    actor.stop()
  })
})
