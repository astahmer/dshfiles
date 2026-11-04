import type { SecretCatalogKeyOption, SecretReferenceResolution } from '@dshfiles/credential-port'
import { HostContext } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { McpHost } from './host-promise.js'

// `secret:ALIAS[@env]` bindings resolve through the Secret Catalog's Host port; other names stay DSH credentials.

const key = (alias: string, environment: string): SecretCatalogKeyOption => ({
  alias,
  environment,
  scope: 'global',
  cwd: null,
  variableName: alias,
  service: '',
  description: '',
})

const mcpHost = (input: { readonly catalog: boolean }) =>
  Effect.gen(function* () {
    const host = yield* Effect.promise(() => createTestHost())
    yield* Effect.addFinalizer(() => Effect.promise(() => host.dispose()))
    const resolved: SecretReferenceResolution[] = []
    const ctx = host.ctx
    ctx.provide('configEditor', { entries: () => [], edit: async () => undefined })
    ctx.provide('credentials', {
      describe: async (reference: string) => ({ configured: reference === 'PLAIN_TOKEN' }),
      resolve: async (reference: string) => (reference === 'PLAIN_TOKEN' ? { value: 'plain-credential-value' } : undefined),
    })
    ctx.provide('webServer', { register: () => () => undefined })
    ctx.provide('settings', { configure: () => () => undefined })
    if (input.catalog) {
      ctx.provide('secretCatalogValues', {
        supportsExpectedScope: true,
        resolve: async (request: SecretReferenceResolution) => {
          resolved.push(request)
          if (request.reference.alias === 'EMPTY') return ''
          return `catalog-value-of-${request.reference.alias}@${request.reference.environment}`
        },
      })
      ctx.provide('secretCatalogCredentials', {
        listKeys: async () => [key('FIGMA_TOKEN', 'prod'), key('SHARED', 'dev'), key('SHARED', 'dev')],
        importKey: async () => undefined,
      })
    }
    const services = yield* Layer.build(McpHost.layer.pipe(Layer.provide(HostContext.layer({ ctx, packageId: '@dshfiles/mcp-servers' }))))
    return { mcp: Context.get(services, McpHost), resolved }
  })

describe('MCP credential bindings from the Secret Catalog', () => {
  it.effect('resolves a secret reference on the Host for global aliases, and reports availability from metadata only', () =>
    Effect.gen(function* () {
      const { mcp, resolved } = yield* mcpHost({ catalog: true })
      expect(yield* mcp.resolveReference('secret:FIGMA_TOKEN')).toEqual(Option.some('catalog-value-of-FIGMA_TOKEN@prod'))
      expect(yield* mcp.resolveReference('secret:FIGMA_TOKEN@staging')).toEqual(Option.some('catalog-value-of-FIGMA_TOKEN@staging'))
      expect(resolved.map(request => request.cwd)).toEqual([null, null])
      expect(yield* mcp.resolveReference('secret:EMPTY')).toEqual(Option.none())
      expect(yield* mcp.isConfigured('secret:FIGMA_TOKEN')).toBe(true)
      expect(yield* mcp.isConfigured('secret:FIGMA_TOKEN@staging')).toBe(false)
      // the same alias in two entries is ambiguous, so it is not offered as configured
      expect(yield* mcp.isConfigured('secret:SHARED@dev')).toBe(false)
      expect(yield* mcp.resolveReference('PLAIN_TOKEN')).toEqual(Option.some('plain-credential-value'))
      expect(yield* mcp.isConfigured('PLAIN_TOKEN')).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect('treats a secret reference as missing while the Secret Catalog is not loaded', () =>
    Effect.gen(function* () {
      const { mcp } = yield* mcpHost({ catalog: false })
      expect(yield* mcp.resolveReference('secret:FIGMA_TOKEN')).toEqual(Option.none())
      expect(yield* mcp.isConfigured('secret:FIGMA_TOKEN')).toBe(false)
    }).pipe(Effect.scoped),
  )
})
