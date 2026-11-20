import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FailedThreadsModel } from './failed-turns-client.js'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('failed-turns-client module', () => {
  it('is published as a dshx module with its exports subpath, so another plugin imports it instead of restating it', () => {
    expect(read('../dshx.config.ts')).toContain("'failed-turns-client': 'src/failed-turns-client.ts'")
    const manifest: { readonly exports: Record<string, unknown> } = JSON.parse(read('../package.json'))
    expect(manifest.exports['./failed-turns-client']).toEqual({ types: './src/failed-turns-client.ts', default: './dist/failed-turns-client.js' })
  })

  it("names the failed threads: the Host's failed-turn record plus an unread finish that failed", () => {
    const ids = FailedThreadsModel.ids(
      [
        { sessionId: 'read-ok', finishedReason: 'completed' },
        { sessionId: 'unread-error', finishedReason: 'error' },
      ],
      ['recorded'],
    )
    expect([...ids].sort()).toEqual(['recorded', 'unread-error'])
  })
})
