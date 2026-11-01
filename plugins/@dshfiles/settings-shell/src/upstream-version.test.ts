import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { PORTED_FROM, WELCOME_PORTED_FROM } from './upstream.js'

describe('settings shell port', () => {
  it('matches the native Settings package this workspace builds against', () => {
    // A DSH bump moves these devDependencies; refresh src/native from the new lib/client.js, then update upstream.ts.
    for (const ported of [PORTED_FROM, WELCOME_PORTED_FROM]) {
      const manifest = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(createRequire(import.meta.url)(`${ported.packageName}/package.json`))
      expect(manifest.version, ported.packageName).toBe(ported.version)
    }
  })
})
