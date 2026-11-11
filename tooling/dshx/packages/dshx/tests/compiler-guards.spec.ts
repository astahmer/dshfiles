import { describe, expect, it } from 'vitest'
import { SecureContextCalls } from '../src/compiler/client/secure-context.js'
import { containsPrivateDshxImport } from '../src/compiler/private-imports.js'
import { resolveVitePlugins } from '../src/config/vite-plugins.js'

describe('private runtime import guard', () => {
  it.each([
    `import { defineHost } from '@dshfiles/dshx/host'`,
    `import '@dshfiles/dshx/client'`,
    `await import('@dshfiles/dshx/tooling')`,
    `require('@dshfiles/dshx/settings')`,
    `export { method } from '@dshfiles/dshx/api'`,
  ])('detects an executable DSHX request in %s', code => {
    expect(containsPrivateDshxImport(code)).toBe(true)
  })

  it('does not mistake an installed source path for an import', () => {
    expect(containsPrivateDshxImport('/tmp/node_modules/.pnpm/@dshfiles+dshx/node_modules/@dshfiles/dshx/dist/client/runtime.js')).toBe(false)
    expect(containsPrivateDshxImport('The public API is @dshfiles/dshx/client.')).toBe(false)
  })
})

describe('secure-context API guard', () => {
  it.each(['const [g]=(0,p.useState)(()=>crypto.randomUUID())', 'fi=()=>globalThis.crypto.randomUUID()', 'id:`view/${e.id}/${crypto?.randomUUID()}`'])(
    'finds the unguarded call in %s',
    code => {
      expect(SecureContextCalls.unguardedCalls(code).map(call => call.api)).toEqual(['crypto.randomUUID'])
    },
  )

  it.each([
    'if(typeof crypto.randomUUID==`function`)return crypto.randomUUID()',
    'return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : fallback()',
    "'randomUUID' in crypto ? crypto.randomUUID() : fallback()",
    'const randomUUID = () => fallback()',
  ])('accepts a feature-checked or unrelated use in %s', code => {
    expect(SecureContextCalls.unguardedCalls(code)).toEqual([])
  })
})

describe('build-watch plugin selection', () => {
  it('drops serve branches while retaining sibling build branches', async () => {
    const scan = { name: 'scan' }
    const serve = { name: 'generate:serve', apply: 'serve' as const }
    const build = { name: 'generate:build', apply: 'build' as const }
    await expect(resolveVitePlugins([[scan, serve, build]], true)).resolves.toEqual([scan, build])
  })

  it('rejects a plugin option that has no build-watch branch', async () => {
    await expect(resolveVitePlugins([{ name: 'serve-only', apply: 'serve' }], true)).rejects.toMatchObject({ code: 'DSHX1402' })
  })
})
