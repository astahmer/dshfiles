import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PORTED_FROM } from './upstream.js'

describe('settings shell port', () => {
  it('matches the native Settings package this workspace builds against', () => {
    const manifest = z.object({ version: z.string() }).parse(createRequire(import.meta.url)(`${PORTED_FROM.packageName}/package.json`))
    // A DSH bump moves this devDependency; refresh src/native from the new lib/client.js, then update PORTED_FROM.
    expect(manifest.version).toBe(PORTED_FROM.version)
  })
})
