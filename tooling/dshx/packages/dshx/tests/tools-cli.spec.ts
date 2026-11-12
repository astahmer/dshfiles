import { Readable, Writable } from 'node:stream'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { defineApi, method } from '../src/api/index.js'
import { parseCliArgs } from '../src/cli/args.js'
import { runToolsCli } from '../src/cli/tools.js'
import { defineHost } from '../src/host/index.js'
import { createTestHost } from '../src/testing/index.js'

const api = defineApi({
  id: 'tools-test',
  version: 1,
  owner: '@test/tools',
  methods: {
    read: method({
      input: Schema.Struct({ value: Schema.String }),
      output: Schema.String,
      description: 'Read a value.',
      tool: { name: 'example_read', readOnly: true },
    }),
    remove: method({
      input: Schema.Struct({ confirm: Schema.Literal(true) }),
      output: Schema.Boolean,
      description: 'Remove explicitly.',
      tool: { name: 'example_remove', readOnly: false },
    }),
  },
})

describe('tools CLI', () => {
  it('lists, describes and safely calls real Host tools', async () => {
    let writes = 0
    const host = await createTestHost()
    try {
      await host.mount(
        defineHost({
          apis: [
            api.host({
              read: ({ input }) => input.value,
              remove: () => {
                writes++
                return true
              },
            }),
          ],
        }),
        { packageId: '@test/tools' },
      )
      const requests: string[] = []
      const request: typeof fetch = async (url, init) => {
        if (typeof init?.body === 'string') requests.push(init.body)
        return host.connection.fetch(url, init)
      }
      const run = async (argv: string[]) => {
        let stdout = ''
        let stderr = ''
        const io = {
          stdin: Readable.from([]),
          stdout: new Writable({
            write(chunk, _encoding, done) {
              stdout += String(chunk)
              done()
            },
          }),
          stderr: new Writable({
            write(chunk, _encoding, done) {
              stderr += String(chunk)
              done()
            },
          }),
        }
        const code = await runToolsCli({ args: parseCliArgs(['tools', ...argv]), io, origin: 'http://dshx.test', fetch: request })
        return { code, stdout, stderr }
      }
      expect((await run(['list'])).stdout).toMatch(/example_read\s+read/)
      expect((await run(['list'])).stdout).toMatch(/example_remove\s+write/)
      requests.length = 0
      expect((await run(['describe', 'example_remove'])).stdout).toMatch(/"required": \[\s*"confirm"/)
      expect(requests).toHaveLength(2)
      expect(requests[0]).toContain('"input":{}')
      expect(requests[1]).toContain('"input":{"owner":"@test/tools","schemas":true}')
      expect((await run(['call', 'example_read', '--input', '{"value":"hello"}'])).stdout).toContain('hello')
      expect((await run(['call', 'example_remove', '--input', '{"confirm":true}'])).code).not.toBe(0)
      expect(writes).toBe(0)
      expect((await run(['call', 'example_remove', '--write', '--input', '{}'])).code).not.toBe(0)
      expect(writes).toBe(0)
      expect((await run(['call', 'example_remove', '--write', '--input', '{"confirm":true}'])).code).toBe(0)
      expect(writes).toBe(1)
      expect((await run(['describe', 'missing'])).stderr).toContain('dshx tools list')
      expect((await run(['call', 'example_read', '--input', '[]'])).code).not.toBe(0)
      expect(() => parseCliArgs(['tools', 'list', '--write'])).toThrow()
    } finally {
      await host.dispose()
    }
  })
})
