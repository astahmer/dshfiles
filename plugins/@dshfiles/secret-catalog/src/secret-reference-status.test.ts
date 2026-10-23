import { describe, expect, it } from 'vitest'
import { SecretCliError } from './secret-cli-runner.js'
import type { SecretMetadata } from './secret-metadata.js'
import type { SecretCatalogOperations } from './secret-operations.js'
import { checkSecretReference } from './secret-reference-status.js'

const row = (overrides: Partial<SecretMetadata>): SecretMetadata => ({
  id: 'row',
  alias: 'DSH_JEV_BACKLOG',
  scope: 'global',
  environment: 'prod',
  variableName: 'DSH_JEV_BACKLOG',
  item: 'global/dsh-jev-backlog',
  field: 'password',
  service: '',
  description: '',
  ...overrides,
})

const operationsWith = (input: {
  readonly rows?: readonly SecretMetadata[]
  readonly rowsByFolder?: Readonly<Record<string, readonly SecretMetadata[]>>
  readonly listError?: Error
  readonly revealError?: Error
  readonly value?: string
}): Pick<SecretCatalogOperations, 'list' | 'reveal'> => ({
  list: async cwd => {
    if (input.listError !== undefined) throw input.listError
    if (cwd !== null) return input.rowsByFolder?.[cwd] ?? []
    return input.rows ?? []
  },
  reveal: async () => {
    if (input.revealError !== undefined) throw input.revealError
    return input.value ?? 'synthetic-value'
  },
})

const plainGlobalConfig = async () => ({ path: '/home/synthetic/.config/secret/config.json', linkedTo: null })

const check = (referenceText: string, operations: Pick<SecretCatalogOperations, 'list' | 'reveal'>, probeFolders: readonly string[] = []) =>
  checkSecretReference({ operations, referenceText, cwd: null, probeFolders, inspectGlobalConfig: plainGlobalConfig })

describe('secret reference status', () => {
  it('reports an empty field and a non-reference without calling the CLI', async () => {
    const operations = operationsWith({ listError: new Error('must not run') })
    expect((await check('  ', operations)).state).toBe('empty')
    expect(await check('plain-text-key', operations)).toMatchObject({ state: 'invalid-reference', alias: null })
  })

  it('names a missing alias with its canonical reference', async () => {
    const status = await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [row({ alias: 'OTHER' })] }))
    expect(status).toMatchObject({ state: 'alias-missing', reference: 'secret:DSH_JEV_BACKLOG', alias: 'DSH_JEV_BACKLOG', environment: 'prod' })
  })

  it('says the alias is missing from every scope, or names the project that holds it', async () => {
    const everywhere = await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [] }), ['/work/one'])
    expect(everywhere).toMatchObject({ state: 'alias-missing', elsewhere: [], writeScope: 'global' })
    const projectOnly = await check(
      'secret:DSH_JEV_BACKLOG',
      operationsWith({ rows: [], rowsByFolder: { '/work/one': [row({ scope: 'project' }), row({ alias: 'OTHER', scope: 'project' })] } }),
      ['/work/one'],
    )
    expect(projectOnly.elsewhere).toEqual([{ scope: 'project', folder: '/work/one', environment: 'prod' }])
  })

  it('reports a symlinked global config so a global write is never silent', async () => {
    const status = await checkSecretReference({
      operations: operationsWith({ rows: [] }),
      referenceText: 'secret:DSH_JEV_BACKLOG',
      cwd: null,
      inspectGlobalConfig: async () => ({ path: '/home/synthetic/.config/secret/config.json', linkedTo: '/home/synthetic/nixfiles/global.json' }),
    })
    expect(status.globalConfig.linkedTo).toBe('/home/synthetic/nixfiles/global.json')
  })

  it('lists the environments that do exist when only the environment is wrong', async () => {
    const status = await check('secret:DSH_JEV_BACKLOG@staging', operationsWith({ rows: [row({ environment: 'prod' }), row({ environment: 'dev' })] }))
    expect(status).toMatchObject({ state: 'environment-missing', reference: 'secret:DSH_JEV_BACKLOG@staging', environments: ['dev', 'prod'] })
  })

  it('refuses to guess between scopes', async () => {
    const status = await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [row({ scope: 'global' }), row({ scope: 'project' })] }))
    expect(status).toMatchObject({ state: 'ambiguous', scopes: ['global', 'project'] })
  })

  it('resolves a unique alias whose value reads back non-empty', async () => {
    expect(await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [row({})] }))).toMatchObject({ state: 'resolved', scope: 'global' })
  })

  it('reports an unreadable or empty vault value against the matched scope', async () => {
    const unreadable = await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [row({})], revealError: new SecretCliError('cli-failed') }))
    expect(unreadable).toMatchObject({ state: 'value-unreadable', scope: 'global' })
    expect((await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [row({})], value: '' }))).state).toBe('value-empty')
  })

  it('maps CLI failures to their typed codes', async () => {
    expect((await check('secret:X', operationsWith({ listError: new SecretCliError('cli-missing') }))).state).toBe('cli-missing')
    expect((await check('secret:X', operationsWith({ listError: new SecretCliError('cli-timeout') }))).state).toBe('cli-timeout')
    expect((await check('secret:X', operationsWith({ listError: new Error('anything') }))).state).toBe('cli-failed')
    const timedOutRead = await check('secret:DSH_JEV_BACKLOG', operationsWith({ rows: [row({})], revealError: new SecretCliError('cli-timeout') }))
    expect(timedOutRead.state).toBe('cli-timeout')
  })
})
