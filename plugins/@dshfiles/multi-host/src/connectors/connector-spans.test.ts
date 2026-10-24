import { createServer, type Server } from 'node:http'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { connectGateway } from './gateway.js'
import { SshConnector } from './ssh.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** A loopback runtime that hands out a session cookie and rejects every API call as expired. */
const startRuntime = async (): Promise<string> => {
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=synthetic; HttpOnly' }).end()
      return
    }
    response.writeHead(401).end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String(z.object({ port: z.number().int() }).parse(server.address()).port)}`
}

describe('multi-host connector spans', () => {
  it('records one <namespace>/<method> gateway span with the outcome code, never the arguments', async () => {
    const origin = await startRuntime()
    const gateway = await connectGateway({
      launchUrl: `${origin}/?token=synthetic-token`,
      createTransport: async () => ({ origin, dispose: async () => undefined }),
    })
    using recorder = recordSpans()
    const outcome = await gateway.runSafe('session', 'list', { secretArgument: 'synthetic-argument' })
    expect(outcome).toMatchObject({ ok: false, code: 'authentication-expired' })
    const span = recorder.span('session/list')
    expect(span.kind).toBe('client')
    expect(span.attributes).toMatchObject({ 'rpc.service': 'session', 'rpc.method': 'list', 'multi_host.outcome': 'authentication-expired' })
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-argument|synthetic-token/)
    await gateway.dispose()
  })

  it('records an ssh command span that fails on a refused target before ssh starts', async () => {
    using recorder = recordSpans()
    await expect(SshConnector.run({ sshTarget: '-oProxyCommand=evil', command: 'true' })).rejects.toThrow()
    const span = recorder.span('ssh command')
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toContain('evil')
  })
})
