import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTENSION_ID, EXTENSION_ORIGIN, deriveExtensionId, extensionOrigins } from '../src/extension.js'

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'extension', 'manifest.json'), 'utf8')) as { readonly key?: string }

describe('extension identity', () => {
  it('derives the pinned id from the committed manifest key', () => {
    expect(manifest.key).toBeDefined()
    expect(deriveExtensionId(manifest.key ?? '')).toBe(EXTENSION_ID)
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}`)
  })

  it('trusts only the pinned origin by default', () => {
    expect(extensionOrigins({ env: {} })).toEqual([EXTENSION_ORIGIN])
  })

  it('lets an explicit env override point at another build', () => {
    const other = `chrome-extension://${'a'.repeat(32)}`
    expect(extensionOrigins({ env: { DSH_ANNOTATIONS_EXTENSION_ORIGINS: ` , ${other} ` } })).toEqual([other])
  })
})
