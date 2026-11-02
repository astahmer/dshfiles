import { createConnection } from 'node:net'
import { Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { LegacyRuntime } from '../src/legacy-runtime-promise.js'
import { afterAll, describe, expect, test } from 'vitest'
import { SshConnector } from '../src/connectors/ssh.js'
import type { Ssh } from '../src/ssh.js'
import { exitCode, sshLayer } from './fixtures/ssh-runtime.js'

const runtime = ManagedRuntime.make(Layer.mergeAll(sshLayer, FetchHttpClient.layer))
afterAll(() => runtime.dispose())

const failureCode = async (effect: Effect.Effect<unknown, unknown, Ssh | HttpClient.HttpClient | Scope.Scope>, signal?: AbortSignal): Promise<string> =>
  exitCode(await runtime.runPromiseExit(Effect.scoped(effect), signal === undefined ? undefined : { signal }))

const connect = async (input: { readonly sshTarget: string; readonly remoteHome: string }) => {
  const scope = await runtime.runPromise(Scope.make())
  const gateway = await runtime.runPromise(Scope.provide(scope)(SshConnector.connect(input)))
  return LegacyRuntime.toPromiseGateway({ gateway, close: () => runtime.runPromise(Scope.close(scope, Exit.void)) })
}

const localSshdListening = (): Promise<boolean> =>
  new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 22 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

// The system OpenSSH client, exactly as the connector runs it.
describe('SSH connector error mapping (real ssh)', () => {
  test('an unresolvable host maps to ssh-host-unresolved', async () => {
    expect(await failureCode(SshConnector.probe({ sshTarget: 'nobody@multi-host-test.invalid' }))).toBe('ssh-host-unresolved')
  })

  test('a refused port maps to ssh-unreachable', async context => {
    if (await localSshdListening()) context.skip()
    expect(await failureCode(SshConnector.probe({ sshTarget: 'nobody@127.0.0.1' }))).toBe('ssh-unreachable')
  })

  test('a shell-shaped target is refused before ssh runs', async () => {
    expect(await failureCode(SshConnector.probe({ sshTarget: 'host; touch /tmp/pwned' }))).toBe('invalid-ssh-target')
  })

  test('a cancelled probe stops ssh', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await failureCode(SshConnector.probe({ sshTarget: 'nobody@multi-host-test.invalid' }), controller.signal)).toBe('cancelled')
  })
})

// Live checks against a real machine running a DSH with @dshfiles/multi-host:
// MULTI_HOST_SSH_TARGET=raspberrypi@raspberrypi MULTI_HOST_SSH_HOME=/home/raspberrypi/dsh-host-picker/home pnpm test
const sshTarget = process.env.MULTI_HOST_SSH_TARGET
const remoteHome = process.env.MULTI_HOST_SSH_HOME
describe.skipIf(sshTarget === undefined || remoteHome === undefined)('SSH connector against a live host', () => {
  const target = sshTarget ?? ''
  const home = remoteHome ?? ''

  test('discovers the remote DSH home from its launch file', async () => {
    const homes = await runtime.runPromise(SshConnector.discoverHomes({ sshTarget: target }))
    expect(homes).toContainEqual({ path: home, source: 'multi-host' })
  })

  test('a missing launch file maps to runtime-not-running', async () => {
    expect(await failureCode(SshConnector.connect({ sshTarget: target, remoteHome: '/nonexistent/dsh-home' }))).toBe('runtime-not-running')
  })

  test('one tunnel serves consecutive calls', async () => {
    const gateway = await connect({ sshTarget: target, remoteHome: home })
    try {
      expect(await gateway.api('identity')).toMatchObject({ protocolVersion: 1 })
      const startedAt = Date.now()
      await gateway.run('session', 'list', { _request: {} })
      expect(Date.now() - startedAt).toBeLessThan(300)
    } finally {
      await gateway.dispose()
    }
  }, 60_000)
})
