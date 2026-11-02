import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { importCredentialKey, listCredentialKeys, type SecretKeyImportRequest } from './credential-bridge.js'
import { DshCredentials } from './dsh-credentials-promise.js'
import { catalogWithRows } from './secret-catalog-fixture.js'

const metadata = (alias = 'OPENCODE_GO_KEY', scope = 'global') => ({
  alias,
  scope,
  env: 'prod',
  envKey: alias,
  item: 'opencode-go',
  field: 'password',
  service: 'OpenCode Go',
  value: 'synthetic-secret-must-not-cross',
})

interface Store {
  readonly configured: boolean
  readonly writable: boolean
  readonly writes: { ref: string; value: string }[]
}

const store = (target: { readonly configured: boolean; readonly writable: boolean }): Store => ({ ...target, writes: [] })

const credentialStore = (target: Store) => ({
  describe: async () => ({ configured: target.configured, writable: target.writable }),
  set: async (ref: string, value: string) => {
    target.writes.push({ ref, value })
  },
})

const bridge = (input: { readonly rows: readonly Record<string, string>[]; readonly target?: Store }) => {
  const fixture = catalogWithRows({ rows: input.rows })
  const layer = Layer.merge(fixture.layer, DshCredentials.layerTest(input.target === undefined ? undefined : credentialStore(input.target)))
  return {
    requests: fixture.requests,
    listKeys: (cwd: string | null) => listCredentialKeys(cwd).pipe(Effect.provide(layer)),
    importKey: (request: SecretKeyImportRequest) => importCredentialKey(request).pipe(Effect.provide(layer)),
  }
}

const globalImport: SecretKeyImportRequest = {
  alias: 'OPENCODE_GO_KEY',
  environment: 'prod',
  scope: 'global',
  cwd: null,
  targetRef: 'OPENCODEX_OPENCODE_GO_API_KEY',
}

describe('Secret Catalog credential bridge', () => {
  it.effect('projects only unique, value-free metadata for supported scopes', () =>
    Effect.gen(function* () {
      const fixture = bridge({
        rows: [
          metadata(),
          metadata('PROJECT_KEY', 'project'),
          metadata('LOCAL_KEY', 'local'),
          metadata('UNKNOWN_SCOPE', 'unknown'),
          metadata('DUPLICATE_KEY', 'project'),
          metadata('DUPLICATE_KEY', 'project'),
        ],
      })
      const options = yield* fixture.listKeys('/tmp/project')
      const option = (alias: string, scope: string, cwd: string | null) => ({
        alias,
        environment: 'prod',
        scope,
        cwd,
        variableName: alias,
        service: 'OpenCode Go',
        description: 'OpenCode Go',
      })
      expect(options).toEqual([
        option('OPENCODE_GO_KEY', 'global', null),
        option('PROJECT_KEY', 'project', '/tmp/project'),
        option('LOCAL_KEY', 'local', '/tmp/project'),
      ])
      expect(JSON.stringify(options)).not.toContain('synthetic-secret')
    }),
  )

  it.effect('stores a selected secret in the write-only credential provider', () =>
    Effect.gen(function* () {
      const target = store({ configured: false, writable: true })
      const fixture = bridge({ rows: [metadata()], target })
      yield* fixture.importKey(globalImport)
      expect(target.writes).toEqual([{ ref: 'OPENCODEX_OPENCODE_GO_API_KEY', value: 'synthetic-secret-value' }])
      expect(fixture.requests.filter(request => request.args[0] === 'get')).toEqual([
        { args: ['get', 'OPENCODE_GO_KEY', '--env', 'prod', '--config', expect.any(String)], cwd: null, captureStdout: true },
      ])
    }),
  )

  it.effect('imports a project-scoped key only from the explicitly selected folder', () =>
    Effect.gen(function* () {
      const target = store({ configured: false, writable: true })
      const fixture = bridge({ rows: [metadata('PROJECT_KEY', 'project')], target })
      yield* fixture.importKey({ ...globalImport, alias: 'PROJECT_KEY', scope: 'project', cwd: '/tmp/project' })
      expect(target.writes).toEqual([{ ref: 'OPENCODEX_OPENCODE_GO_API_KEY', value: 'synthetic-secret-value' }])
      expect(fixture.requests.find(request => request.args[0] === 'get')?.cwd).toBe('/tmp/project')
      expect(JSON.stringify(fixture.requests.filter(request => request.args[0] !== 'get'))).not.toContain('synthetic-secret')
    }),
  )

  it.effect('refuses invalid target refs and ambiguous catalog entries before revealing a value', () =>
    Effect.gen(function* () {
      const fixture = bridge({ rows: [metadata(), metadata()], target: store({ configured: false, writable: true }) })
      expect((yield* Effect.flip(fixture.importKey({ ...globalImport, targetRef: 'PATH' }))).message).toBe('Choose an API-key variable ending in _API_KEY.')
      expect((yield* Effect.flip(fixture.importKey(globalImport))).message).toBe('That Secret Catalog entry is unavailable or ambiguous.')
      expect(fixture.requests.every(request => request.args[0] !== 'get')).toBe(true)
    }),
  )

  it.effect('does not reveal the source when the destination is shadowed by a read-only source', () =>
    Effect.gen(function* () {
      const fixture = bridge({ rows: [metadata()], target: store({ configured: true, writable: false }) })
      expect((yield* Effect.flip(fixture.importKey(globalImport))).message).toBe(
        'That variable is supplied by a read-only source; choose another API-key variable.',
      )
      expect(fixture.requests.every(request => request.args[0] !== 'get')).toBe(true)
    }),
  )

  it.effect('does not overwrite an already configured writable destination without confirmation', () =>
    Effect.gen(function* () {
      const fixture = bridge({ rows: [metadata()], target: store({ configured: true, writable: true }) })
      expect((yield* Effect.flip(fixture.importKey(globalImport))).message).toBe(
        'That API-key variable already has a value; confirm replacement or choose another reference.',
      )
      expect(fixture.requests.every(request => request.args[0] !== 'get')).toBe(true)
    }),
  )

  it.effect('replaces an existing writable credential only when explicitly requested', () =>
    Effect.gen(function* () {
      const target = store({ configured: true, writable: true })
      yield* bridge({ rows: [metadata()], target }).importKey({ ...globalImport, replaceExisting: true })
      expect(target.writes).toEqual([{ ref: 'OPENCODEX_OPENCODE_GO_API_KEY', value: 'synthetic-secret-value' }])
    }),
  )

  it.effect('reports a missing DSH credential store', () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(bridge({ rows: [metadata()] }).importKey(globalImport))).message).toBe('The DSH credential store is unavailable.')
    }),
  )
})
