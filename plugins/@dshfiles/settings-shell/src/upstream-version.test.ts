import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PORTED_FROM, WELCOME_PORTED_FROM } from './upstream.js'

describe('settings shell port', () => {
  it('matches the native Settings package this workspace builds against', () => {
    // A DSH bump moves these devDependencies; refresh src/native from the new lib/client.js, then update upstream.ts.
    for (const ported of [PORTED_FROM, WELCOME_PORTED_FROM]) {
      const manifest = z.object({ version: z.string() }).parse(createRequire(import.meta.url)(`${ported.packageName}/package.json`))
      expect(manifest.version, ported.packageName).toBe(ported.version)
    }
  })
})
