import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDshxConfig } from '../src/config/resolve.js'
import { checkPackageTargets, checkProjectManifest } from '../src/project/index.js'
import { writePluginFixture } from './plugin-fixture.js'

const temporaryDirectories: string[] = []

function fullManifest(): Record<string, unknown> {
  return {
    name: '@test/plugin',
    type: 'module',
    main: './dist/index.js',
    exports: {
      '.': './dist/index.js',
      './client': './dist/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['dist', 'cordis.patch.yml'],
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: [], external: [], immediately: false },
    },
  }
}

async function temporaryProject(options: { host?: boolean; client?: boolean } = {}): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'dshx-manifest-')))
  temporaryDirectories.push(root)
  const host = options.host ?? true
  const client = options.client ?? true
  const manifest = fullManifest()
  if (!client) {
    delete (manifest.exports as Record<string, unknown>)['./client']
    delete (manifest.dsh as Record<string, unknown>).client
  }
  await writeFile(resolve(root, 'package.json'), JSON.stringify(manifest, null, 2))
  await writeFile(resolve(root, 'cordis.patch.yml'), '- insert: []\n')
  await mkdir(resolve(root, 'src'), { recursive: true })
  if (host) await writeFile(resolve(root, 'src/host.ts'), 'export function apply() {}\n')
  if (client) await writeFile(resolve(root, 'src/client.tsx'), 'export function apply() {}\n')
  return root
}

async function writeManifest(root: string, manifest: unknown): Promise<void> {
  await writeFile(resolve(root, 'package.json'), JSON.stringify(manifest, null, 2))
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
describe('checkProjectManifest', () => {
  it('accepts valid full, Host-only, and Client-only projects', async () => {
    const full = await temporaryProject()
    const hostOnly = await temporaryProject({ client: false })
    const clientOnly = await temporaryProject({ host: false })

    await expect(checkProjectManifest(await resolveDshxConfig({ cwd: full }))).resolves.toEqual([])
    await expect(checkProjectManifest(await resolveDshxConfig({ cwd: hostOnly }))).resolves.toEqual([])
    await expect(checkProjectManifest(await resolveDshxConfig({ cwd: clientOnly }))).resolves.toEqual([])
  })

  it('accepts one-level conditional exports with string defaults', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    manifest.exports = {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './client': { browser: './dist/client.js', default: './dist/client.js' },
      './cordis.patch.yml': { default: './cordis.patch.yml' },
      './package.json': { default: './package.json' },
    }
    await writeManifest(root, manifest)
    await expect(checkProjectManifest(await resolveDshxConfig({ cwd: root }))).resolves.toEqual([])
  })

  it('verifies every concrete export, types, main, and bin target after build', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    manifest.types = './dist/index.d.ts'
    manifest.bin = { demo: './dist/cli.js' }
    manifest.exports = {
      ...(manifest.exports as object),
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './client': { types: './dist/client.d.ts', default: './dist/client.js' },
    }
    await writeManifest(root, manifest)
    await mkdir(resolve(root, 'dist'), { recursive: true })
    for (const file of ['index.js', 'index.d.ts', 'client.js', 'client.d.ts', 'cli.js']) await writeFile(resolve(root, 'dist', file), '')
    const config = await resolveDshxConfig({ cwd: root })
    await expect(checkPackageTargets(config)).resolves.toEqual([])
    await rm(resolve(root, 'dist/client.d.ts'))
    await expect(checkPackageTargets(config)).resolves.toContainEqual(
      expect.objectContaining({ code: 'DSHX4192', message: expect.stringContaining('./dist/client.d.ts') }),
    )
  })

  it('accepts npm main, types, and bin paths without a dot-slash prefix', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    manifest.main = 'dist/index.js'
    manifest.types = 'dist/index.d.ts'
    manifest.bin = { demo: 'dist/cli.js' }
    await writeManifest(root, manifest)
    await mkdir(resolve(root, 'dist'), { recursive: true })
    for (const file of ['index.js', 'index.d.ts', 'client.js', 'cli.js']) await writeFile(resolve(root, 'dist', file), '')

    await expect(checkPackageTargets(await resolveDshxConfig({ cwd: root }))).resolves.toEqual([])
  })

  it('still requires package exports to use concrete dot-slash targets', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    manifest.exports = { '.': 'dist/index.js' }
    await writeManifest(root, manifest)
    await mkdir(resolve(root, 'dist'), { recursive: true })
    await writeFile(resolve(root, 'dist/index.js'), '')

    await expect(checkPackageTargets(await resolveDshxConfig({ cwd: root }))).resolves.toContainEqual(
      expect.objectContaining({ code: 'DSHX4192', message: expect.stringContaining('exports.') }),
    )
  })

  it('accepts the checked-in plugin fixture', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-manifest-fixture-'))
    temporaryDirectories.push(root)
    await writePluginFixture(root)
    const resolved = await resolveDshxConfig({ cwd: root })
    await expect(checkProjectManifest(resolved)).resolves.toEqual([])
  })

  it('reports invalid JSON that appears after resolution', async () => {
    const root = await temporaryProject()
    const resolved = await resolveDshxConfig({ cwd: root })
    await writeFile(resolve(root, 'package.json'), '{')
    await expect(checkProjectManifest(resolved)).resolves.toEqual([
      expect.objectContaining({ code: 'DSHX4101', severity: 'error', file: resolve(root, 'package.json') }),
    ])
  })

  it('validates the package-owned DSHX feature catalog and its project-relative path', async () => {
    const root = await temporaryProject()
    const resolved = await resolveDshxConfig({ cwd: root })
    const manifest = fullManifest()
    Object.assign(manifest, { dshx: { features: './dshx.features.json' } })
    await writeManifest(root, manifest)
    await writeFile(
      resolve(root, 'dshx.features.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'bundle',
        features: [
          {
            id: 'send-message',
            title: 'Send a message',
            summary: 'Submit a user message to the active conversation.',
            surfaces: ['client'],
            configuration: [],
            states: ['ready', 'sending', 'failed'],
            failureModes: ['The active conversation rejects the message.'],
            externalDependencies: [],
            verification: [{ kind: 'gherkin', id: 'plugin.send-message', featureFile: 'tests/plugin.feature' }],
            telemetry: [{ kind: 'not-applicable', reason: 'Client presentation only; the message goes through the native composer.' }],
          },
        ],
      }),
    )
    await expect(checkProjectManifest(resolved)).resolves.toEqual([])

    await writeFile(resolve(root, 'dshx.features.json'), JSON.stringify({ schemaVersion: 1, features: [] }))
    await expect(checkProjectManifest(resolved)).resolves.toContainEqual(expect.objectContaining({ code: 'DSHX4232', severity: 'error' }))

    Object.assign(manifest, { dshx: { features: '../outside.json' } })
    await writeManifest(root, manifest)
    await expect(checkProjectManifest(resolved)).resolves.toContainEqual(expect.objectContaining({ code: 'DSHX4230', severity: 'error' }))
  })

  it('collects manifest, bundle, export, Client, and publishing problems in one pass', async () => {
    const root = await temporaryProject()
    const resolved = await resolveDshxConfig({ cwd: root })
    await writeManifest(root, {
      name: '',
      type: 'commonjs',
      exports: {},
      dsh: { client: { platform: 'desktop' } },
    })
    await rm(resolve(root, 'cordis.patch.yml'))

    const diagnostics = await checkProjectManifest(resolved)
    expect(new Set(diagnostics.map(item => item.code))).toEqual(
      new Set(['DSHX4101', 'DSHX4102', 'DSHX4110', 'DSHX4120', 'DSHX4121', 'DSHX4122', 'DSHX4123', 'DSHX4190', 'DSHX4191', 'DSHX4210', 'DSHX4211']),
    )
    expect(diagnostics.every(item => item.file.length > 0)).toBe(true)
    expect(diagnostics.every(item => item.hint.length > 0)).toBe(true)
    expect(diagnostics.filter(item => item.severity === 'error')).toHaveLength(9)
    expect(diagnostics.filter(item => item.severity === 'warning')).toHaveLength(2)
  })

  it('validates Client arrays, booleans, self requests, and the protocol-2 baseline', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    ;(manifest.dsh as { client: Record<string, unknown> }).client = {
      platform: 'web',
      inject: ['ok', 'ok', '', 1],
      external: ['@test/plugin/internal', 'react', '@deepseek-ai/dsh-client-connection/client', '@example/extra', '@example/extra'],
      immediately: 'false',
    }
    await writeManifest(root, manifest)

    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics.filter(item => item.code === 'DSHX4212')).toHaveLength(2)
    expect(diagnostics.filter(item => item.code === 'DSHX4213')).toHaveLength(1)
    expect(diagnostics.filter(item => item.code === 'DSHX4214')).toHaveLength(1)
    expect(diagnostics.filter(item => item.code === 'DSHX4215')).toHaveLength(3)
  })

  it('requires the shared-runtime supplier in dsh.client.external', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    await writeManifest(root, manifest)
    const resolved = await resolveDshxConfig({ cwd: root })
    const missing = await checkProjectManifest({ ...resolved, clientShared: '@test/runtime' })
    expect(missing.filter(item => item.code === 'DSHX4233')).toHaveLength(1)
    ;(manifest.dsh as { client: Record<string, unknown> }).client = {
      ...(manifest.dsh as { client: Record<string, unknown> }).client,
      external: ['@test/runtime'],
    }
    await writeManifest(root, manifest)
    const declared = await checkProjectManifest({ ...(await resolveDshxConfig({ cwd: root })), clientShared: '@test/runtime' })
    expect(declared.filter(item => item.code === 'DSHX4233')).toHaveLength(0)
  })

  it('previews the hook-driven Settings provider edge through the local Client graph', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/settings-view.tsx'),
      [
        "import { useSettings as useRuntimeSettings } from '@dshfiles/dshx/client'",
        'export function SettingsView(contract: unknown) { return useRuntimeSettings(contract) }',
        '',
      ].join('\n'),
    )
    await writeFile(resolve(root, 'src/client.tsx'), "import { SettingsView } from './settings-view.js'\nexport const apply = SettingsView\n")
    const missing = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(missing).toContainEqual(expect.objectContaining({ code: 'DSHX4216', severity: 'error' }))

    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-ui-settings')
    await writeManifest(root, manifest)
    const complete = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4216' }))
  })

  it('previews the hook-driven API provider edge through aliases and the local Client graph', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/api-view.tsx'),
      ["import { useApiQuery as query } from '@dshfiles/dshx/client'", "export function ApiView(contract: unknown) { return query(contract, 'get') }", ''].join(
        '\n',
      ),
    )
    await writeFile(resolve(root, 'src/client.tsx'), "import { ApiView } from './api-view.js'\nexport const apply = ApiView\n")
    const missing = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(missing).toContainEqual(
      expect.objectContaining({
        code: 'DSHX4218',
        severity: 'error',
        hint: expect.stringContaining('@deepseek-ai/dsh-client-connection'),
      }),
    )

    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-connection')
    await writeManifest(root, manifest)
    const complete = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4218' }))
  })

  it('does not infer an API provider from a bare or voided hook import', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { useApi } from '@dshfiles/dshx/client'", 'void useApi', 'export function apply() {}', ''].join('\n'),
    )
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'DSHX4218' }))
  })

  it('warns when an injected Client provider is not a peer dependency', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-locale')
    await writeManifest(root, manifest)
    expect(await checkProjectManifest(await resolveDshxConfig({ cwd: root }))).toContainEqual(
      expect.objectContaining({ code: 'DSHX4224', severity: 'warning', message: expect.stringContaining('@deepseek-ai/dsh-client-locale') }),
    )

    await writeManifest(root, { ...manifest, peerDependencies: { '@deepseek-ai/dsh-client-locale': '>=0.2.0-rc.1 <0.3.0-0' } })
    expect(await checkProjectManifest(await resolveDshxConfig({ cwd: root }))).not.toContainEqual(expect.objectContaining({ code: 'DSHX4224' }))
  })

  it('checks Cordis service injection while accepting the immediate native Locale provider', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export default defineClient({ inject: ['slots'], setup(ctx) { ctx.effect(() => ctx.locale.register('demo', {})) } })",
        '',
      ].join('\n'),
    )

    const missingBoth = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(missingBoth).toContainEqual(
      expect.objectContaining({ code: 'DSHX4219', severity: 'error', file: resolve(root, 'src/client.tsx'), hint: expect.stringContaining('defineClient') }),
    )
    expect(missingBoth).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))

    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export default defineClient({ inject: ['locale'], setup(ctx) { ctx.effect(() => ctx['locale'].register('demo', {})) } })",
        '',
      ].join('\n'),
    )
    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-locale')
    await writeManifest(root, manifest)

    const complete = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4219' }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))
  })

  it('requires an optional native service package edge and reports its actual owner', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export default defineClient({ inject: ['layout'], setup(ctx) { return ctx.layout.panelInfo } })",
        '',
      ].join('\n'),
    )
    const config = await resolveDshxConfig({ cwd: root })
    const missing = await checkProjectManifest(config)
    expect(missing).toContainEqual(expect.objectContaining({ code: 'DSHX4220', message: expect.stringContaining('@deepseek-ai/dsh-client-ui-layout') }))
    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-ui-layout')
    await writeManifest(root, manifest)
    const complete = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))
  })

  it('reports dynamic SDK capability lists as unknown instead of claiming a clean static check', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClientPlugin } from '@dshfiles/dshx/client'",
        "const resolveUses = () => ['panels'] as const",
        'export default defineClientPlugin({ id: "dynamic-plugin", uses: resolveUses() })',
        '',
      ].join('\n'),
    )
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'DSHX4227', severity: 'warning', message: expect.stringContaining('dynamic') }))
  })

  it('treats non-empty declarative locales as the locale service injection while still requiring the provider edge', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient, defineLocale } from '@dshfiles/dshx/client'",
        "const copy = defineLocale('demo', { zh: { title: '标题' }, en: { title: 'Title' } })",
        "export default defineClient({ locales: [copy], setup(ctx) { return ctx.locale.bind('demo') } })",
        '',
      ].join('\n'),
    )

    const missingProvider = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(missingProvider).not.toContainEqual(expect.objectContaining({ code: 'DSHX4219' }))
    expect(missingProvider).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))
    expect(missingProvider).toContainEqual(
      expect.objectContaining({ code: 'DSHX4221', severity: 'error', hint: expect.stringContaining('@deepseek-ai/dsh-client-locale') }),
    )

    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-locale')
    await writeManifest(root, manifest)
    const complete = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4219' }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4221' }))
  })

  it('accepts what the runtime injects into a setup that declares no inject', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export default defineClient({ setup(ctx) { ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'demo' }, () => null)) } })",
        '',
      ].join('\n'),
    )
    const slotsOnly = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(slotsOnly).not.toContainEqual(expect.objectContaining({ code: 'DSHX4219' }))
    expect(slotsOnly).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))

    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient } from '@dshfiles/dshx/client'", 'export default defineClient({ setup(ctx) { ctx.effect(() => ctx.sessions) } })', ''].join('\n'),
    )
    expect(await checkProjectManifest(await resolveDshxConfig({ cwd: root }))).toContainEqual(expect.objectContaining({ code: 'DSHX4219' }))
  })

  it('does not mistake base Context methods for optional setup services', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient } from '@dshfiles/dshx/client'", "export default defineClient({ setup(ctx) { ctx.effect(() => 'ready') } })", ''].join('\n'),
    )
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'DSHX4219' }))
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'DSHX4220' }))
  })

  it('previews Conversation component provider edges from defineClient()', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient as client } from '@dshfiles/dshx/client'",
        'const contribution = {}',
        'export default client({ conversations: [contribution] })',
        '',
      ].join('\n'),
    )
    const missing = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(missing).toContainEqual(
      expect.objectContaining({
        code: 'DSHX4217',
        severity: 'error',
        hint: expect.stringContaining('@deepseek-ai/dsh-client-ui-conversation'),
      }),
    )

    const manifest = fullManifest()
    ;(manifest.dsh as { client: { inject: string[] } }).client.inject.push('@deepseek-ai/dsh-client-ui-conversation')
    await writeManifest(root, manifest)
    const complete = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(complete).not.toContainEqual(expect.objectContaining({ code: 'DSHX4217' }))
  })

  it('does not infer Conversation providers from an empty contribution list', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import * as dshx from '@dshfiles/dshx/client'", 'export default dshx.defineClient({ conversations: [] })', ''].join('\n'),
    )
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'DSHX4217' }))
  })

  it('follows a local default-export barrel without inventing Conversation providers', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/definition.ts'),
      ["import { defineClient } from '@dshfiles/dshx/client'", "export default defineClient({ name: 'barrel-client', slots: [] })", ''].join('\n'),
    )
    await writeFile(resolve(root, 'src/client.tsx'), "export { default } from './definition.js'\n")
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'DSHX4217' }))
  })

  it('rejects stale Client metadata in a Host-only project', async () => {
    const root = await temporaryProject({ client: false })
    const manifest = fullManifest()
    delete (manifest.exports as Record<string, unknown>)['./client']
    await writeManifest(root, manifest)
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'DSHX4201', severity: 'error' }))
  })

  it('reports missing bundle and Client metadata', async () => {
    const root = await temporaryProject()
    const manifest = fullManifest()
    delete manifest.dsh
    await writeManifest(root, manifest)
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'DSHX4120', severity: 'error' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'DSHX4211', severity: 'error' }))
  })

  it.each([
    ['invalid YAML', '[unterminated', 'DSHX4124'],
    ['non-array YAML', 'name: plugin\n', 'DSHX4124'],
  ])('rejects %s patch content', async (_label, patch, code) => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'cordis.patch.yml'), patch)
    const diagnostics = await checkProjectManifest(await resolveDshxConfig({ cwd: root }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code, severity: 'error' }))
  })

  it('does not modify package.json or the patch file', async () => {
    const root = await temporaryProject()
    const packageFile = resolve(root, 'package.json')
    const patchFile = resolve(root, 'cordis.patch.yml')
    const before = await Promise.all([readFile(packageFile), readFile(patchFile)])

    await checkProjectManifest(await resolveDshxConfig({ cwd: root }))

    const after = await Promise.all([readFile(packageFile), readFile(patchFile)])
    expect(after).toEqual(before)
  })
})

describe('shared modules', () => {
  it('resolves declared shared entries and requires an export subpath for each', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/contract.ts'), 'export const contract = 1\n')
    await writeFile(resolve(root, 'dshx.config.ts'), 'export default { name: "@test/plugin", modules: { contract: "src/contract.ts" } }\n')
    const config = await resolveDshxConfig({ cwd: root })
    expect(config.modules).toEqual([{ name: 'contract', entry: resolve(root, 'src/contract.ts') }])
    await expect(checkPackageTargets(config)).resolves.toContainEqual(
      expect.objectContaining({ code: 'DSHX4192', message: expect.stringContaining('./contract') }),
    )

    const manifest = fullManifest()
    manifest.exports = {
      ...(manifest.exports as object),
      './contract': { types: './src/contract.ts', default: './dist/contract.js' },
    }
    await writeManifest(root, manifest)
    await mkdir(resolve(root, 'dist'), { recursive: true })
    await writeFile(resolve(root, 'dist/contract.js'), '')
    const remaining = await checkPackageTargets(await resolveDshxConfig({ cwd: root }))
    expect(remaining.filter(item => item.message.includes('./contract'))).toEqual([])
  })

  it('rejects a reserved or malformed shared module name', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/contract.ts'), 'export const contract = 1\n')
    await writeFile(resolve(root, 'dshx.config.ts'), 'export default { name: "@test/plugin", modules: { client: "src/contract.ts" } }\n')
    await expect(resolveDshxConfig({ cwd: root })).rejects.toThrow(/Invalid shared module name/u)
  })
})
