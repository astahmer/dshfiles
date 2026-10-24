import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { ManagedLocalCommand } from './local-process.js'
import { createTracedRegistrySearch } from './registry-search-host.js'

describe('mcp-servers spans', () => {
  it('records an mcp registry search span with the status and result count, never the query', async () => {
    using recorder = recordSpans()
    const search = createTracedRegistrySearch({ fetch: async () => new Response(JSON.stringify({ servers: [] }), { status: 200 }) })
    await expect(search.search({ query: 'synthetic private query' })).resolves.toEqual([])
    const span = recorder.span('mcp registry search')
    expect(span.attributes).toMatchObject({ 'http.response.status_code': 200, 'dshx.mcp-servers.results': 0 })
    expect(JSON.stringify(span.attributes)).not.toContain('synthetic private query')
  })

  it('records an mcp server start span with the argument count, never argv or environment', async () => {
    using recorder = recordSpans()
    const handle: SubprocessHandle = {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: new Promise(() => undefined),
      terminate: () => undefined,
      waitForExit: async () => true,
    }
    const runtime: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'> = { resolveExecutable: async () => '/resolved/npx', spawn: () => handle }
    await ManagedLocalCommand.start(runtime, { command: 'npx', args: ['-y', '@example/tunnel'], cwd: '/opt/tunnel' }, { TOKEN: 'secret-never-render' })
    const span = recorder.span('mcp server start')
    expect(span.attributes['dshx.mcp-servers.argument_count']).toBe(2)
    expect(JSON.stringify(span.attributes)).not.toMatch(/tunnel|secret-never-render/)
  })
})
