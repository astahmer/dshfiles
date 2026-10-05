import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from '../src/cli/args.js'
import { runCli } from '../src/cli/run.js'
import type { CliIO } from '../src/cli/run.js'
import { resolveDshxConfig } from '../src/config/resolve.js'
import { createPresetScaffold } from '../src/scaffold/preset.js'
import type { ResolvedDshxConfig } from '../src/config/types.js'

const CLIENT_ENTRY = `import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { defineClientPlugin, defineLocale } from '@dshfiles/dshx/client'

const copy = defineLocale('demo.status', {
  zh: { title: '状态' },
  en: { title: 'Status' },
})

const Status = (): JSX.Element => <p>{copy.t('title')}</p>

export default defineClientPlugin({
  id: 'demo-plugin',
  uses: ['ui'],
  setup(api) {
    api.ui.register({ name: 'sidebar.footer.action', id: 'demo.status' }, Status)
  },
})
`

const HOST_ENTRY = `import { definePlugin, defineTool } from '@dshfiles/dshx/host'

const statusTool = defineTool({
  name: 'demo_status',
  description: 'Return the demo status.',
  parameters: {},
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute() {
    return 'ready'
  },
})

export default definePlugin({
  id: 'demo-plugin',
  tools: [statusTool],
})
`

const setup = async (faces: 'both' | 'client-only' | 'host-only') => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-preset-'))
  await mkdir(resolve(root, 'src'), { recursive: true })
  await mkdir(resolve(root, 'node_modules/@dshfiles'), { recursive: true })
  await symlink(fileURLToPath(new URL('..', import.meta.url)), resolve(root, 'node_modules/@dshfiles/dshx'))
  await symlink(fileURLToPath(new URL('../node_modules/@deepseek-ai', import.meta.url)), resolve(root, 'node_modules/@deepseek-ai'))
  const manifest = {
    name: '@demo/plugin',
    private: true,
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
      client: {
        platform: 'web',
        inject: [
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-layout',
          '@deepseek-ai/dsh-client-ui-sidebar',
          '@deepseek-ai/dsh-client-ui-slots',
        ],
        external: [],
        immediately: false,
      },
    },
    devDependencies: {
      '@dshfiles/dshx': 'workspace:*',
      '@deepseek-ai/dsh-tools': '0.2.0-rc.2',
      '@deepseek-ai/dsh-tool-cordis': '0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-renderer': '0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-layout': '0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-sidebar': '0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-slots': '0.2.0-rc.2',
    },
    peerDependencies: {
      '@deepseek-ai/dsh': '>=0.2.0-rc.1 <0.3.0-0',
      '@deepseek-ai/dsh-tools': '>=0.2.0-rc.1 <0.3.0-0',
      '@deepseek-ai/dsh-client-ui-renderer': '>=0.2.0-rc.1 <0.3.0-0',
      '@deepseek-ai/dsh-client-ui-layout': '>=0.2.0-rc.1 <0.3.0-0',
      '@deepseek-ai/dsh-client-ui-sidebar': '>=0.2.0-rc.1 <0.3.0-0',
    },
  } as Record<string, unknown>
  if (faces === 'host-only') {
    delete (manifest.exports as Record<string, string>)['./client']
    delete (manifest.dsh as Record<string, unknown>).client
  }
  await writeFile(resolve(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(resolve(root, 'cordis.patch.yml'), '- insert:\n    - id: dshfiles-demo-plugin\n      name: "@demo/plugin"\n')
  const config = [faces === 'client-only' ? '' : "  host: { entry: 'src/host.ts' },", faces === 'host-only' ? '' : "  client: { entry: 'src/client.tsx' },"]
    .filter(Boolean)
    .join('\n')
  await writeFile(resolve(root, 'dshx.config.ts'), `import { defineConfig } from '@dshfiles/dshx'\n\nexport default defineConfig({\n${config}\n})\n`)
  if (faces !== 'host-only') await writeFile(resolve(root, 'src/client.tsx'), CLIENT_ENTRY)
  if (faces !== 'client-only') await writeFile(resolve(root, 'src/host.ts'), HOST_ENTRY)
  const project: ResolvedDshxConfig = {
    ...(await resolveDshxConfig({ cwd: root })),
  }
  // Config resolution realpaths the root, so assertions use the same prefix.
  return { root: project.root, project, cleanup: () => rm(root, { recursive: true, force: true }) }
}

describe('add panel/api CLI', () => {
  it('parses panel and api add targets', () => {
    expect(parseCliArgs(['add', 'panel', '--id', 'usage-history', '--dry-run'])).toMatchObject({
      command: 'add',
      addTarget: 'panel',
      id: 'usage-history',
      dryRun: true,
    })
    expect(parseCliArgs(['add', 'api', '--id', 'status', '--json'])).toMatchObject({ command: 'add', addTarget: 'api', id: 'status', json: true })
    expect(() => parseCliArgs(['add', 'wat'])).toThrow('Unknown argument')
    expect(() => parseCliArgs(['add', 'panel', 'api'])).toThrow('Only one add target')
  })

  it('wires a panel into the client entry and registers both halves', async () => {
    const value = await setup('both')
    try {
      const result = await createPresetScaffold({ project: value.project, preset: 'panel', id: 'usage-history' })
      expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      const client = await readFile(resolve(value.root, 'src/client.tsx'), 'utf8')
      expect(client).toContain("import { UsageHistoryPanel } from './usage-history-panel.js'")
      expect(client).toContain('uses:')
      expect(client).toContain("'panels'")
      expect(client).toContain("api.panels.register({ id: 'usage-history', title: 'usage-history', component: UsageHistoryPanel })")
      expect(client).toContain("import type {} from '@deepseek-ai/dsh-client-ui-layout/client'")
      const component = await readFile(resolve(value.root, 'src/usage-history-panel.tsx'), 'utf8')
      expect(component).toContain('export const UsageHistoryPanel')
      const test = await readFile(resolve(value.root, 'tests/usage-history.spec.ts'), 'utf8')
      expect(test).toContain('createTestClient')
      expect(test).toContain('await client.mount(clientPlugin)')
    } finally {
      await value.cleanup()
    }
  })

  it('supports a dry-run with a diff and no writes', async () => {
    const value = await setup('both')
    try {
      const before = await readFile(resolve(value.root, 'src/client.tsx'), 'utf8')
      const result = await createPresetScaffold({ project: value.project, preset: 'panel', id: 'usage-history', dryRun: true })
      expect(result.diagnostics).toEqual([])
      expect(result.diff).toContain('+++')
      expect(await readFile(resolve(value.root, 'src/client.tsx'), 'utf8')).toBe(before)
      await expect(readFile(resolve(value.root, 'src/usage-history-panel.tsx'), 'utf8')).rejects.toThrow()
    } finally {
      await value.cleanup()
    }
  })

  it('wires an API handler into the host entry with a unique contract module', async () => {
    const value = await setup('both')
    try {
      const first = await createPresetScaffold({ project: value.project, preset: 'api', id: 'status' })
      expect(first.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      expect(first.changedFiles).toContain(resolve(value.root, 'src/api/status.ts'))
      expect(first.changedFiles).toContain(resolve(value.root, 'src/status-host.ts'))
      const contract = await readFile(resolve(value.root, 'src/api/status.ts'), 'utf8')
      expect(contract).toContain("id: 'status'")
      const host = await readFile(resolve(value.root, 'src/host.ts'), 'utf8')
      expect(host).toContain("import { StatusApiHost } from './status-host.js'")
      expect(host).toContain('apis: [StatusApiHost]')
      expect(host).toContain('statusTool')

      const second = await createPresetScaffold({ project: value.project, preset: 'api', id: 'usage-history' })
      expect(second.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      const hostAfter = await readFile(resolve(value.root, 'src/host.ts'), 'utf8')
      expect(hostAfter).toContain('apis: [StatusApiHost, UsageHistoryApiHost]')
      expect(hostAfter).toContain("import { UsageHistoryApiHost } from './usage-history-host.js'")
      expect(second.changedFiles).toContain(resolve(value.root, 'src/api/usage-history.ts'))
      expect(second.changedFiles).not.toContain(resolve(value.root, 'src/api/status.ts'))
    } finally {
      await value.cleanup()
    }
  })

  it('refuses to overwrite an existing contract and keeps entries untouched', async () => {
    const value = await setup('both')
    try {
      const first = await createPresetScaffold({ project: value.project, preset: 'api', id: 'status' })
      expect(first.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      const hostAfterFirst = await readFile(resolve(value.root, 'src/host.ts'), 'utf8')
      const repeat = await createPresetScaffold({ project: value.project, preset: 'api', id: 'status' })
      expect(repeat.diagnostics).toEqual([expect.objectContaining({ code: 'DSHX6302', severity: 'error' })])
      expect(await readFile(resolve(value.root, 'src/host.ts'), 'utf8')).toBe(hostAfterFirst)
    } finally {
      await value.cleanup()
    }
  })

  it('names the owner and stage when the host entry is not a DSHX definition', async () => {
    const value = await setup('both')
    try {
      await writeFile(resolve(value.root, 'src/host.ts'), 'export default {}\n')
      const result = await createPresetScaffold({ project: value.project, preset: 'api', id: 'status' })
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'DSHX6305', severity: 'error' })])
      expect(result.changedFiles).toEqual([])
      await expect(readFile(resolve(value.root, 'src/api/status.ts'), 'utf8')).rejects.toThrow()
    } finally {
      await value.cleanup()
    }
  })

  it('names the missing client entry before writing a panel', async () => {
    const value = await setup('host-only')
    try {
      const result = await createPresetScaffold({ project: value.project, preset: 'panel', id: 'usage-history' })
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'DSHX6301', severity: 'error' })])
      expect(result.changedFiles).toEqual([])
      await expect(readFile(resolve(value.root, 'src/usage-history-panel.tsx'), 'utf8')).rejects.toThrow()
    } finally {
      await value.cleanup()
    }
  })

  it('runs through runCli with JSON output and injected runtime', async () => {
    const streams = (): CliIO & { out: PassThrough; err: PassThrough } => {
      const stdin = new PassThrough() as PassThrough & { isTTY?: boolean }
      stdin.isTTY = false
      const out = new PassThrough()
      const err = new PassThrough()
      return { stdin, stdout: out, stderr: err, out, err }
    }
    const project = (): ResolvedDshxConfig => ({
      root: '/project/plugin',
      packageFile: '/project/plugin/package.json',
      configDependencies: [],
      packageId: 'demo-plugin',
      name: 'demo-plugin',
      hostEntry: '/project/plugin/src/host.ts',
      clientEntry: '/project/plugin/src/client.tsx',
      outDir: '/project/plugin/dist',
      profile: 'web',
      dev: { hostRestart: 'manual' },
      build: { sourcemap: true },
      compatibility: { allowUnsupported: false },
      manifest: { name: 'demo-plugin' },
    })
    const addPreset = vi.fn(async () => ({
      root: '/project/plugin',
      preset: 'panel' as const,
      id: 'usage-history',
      changedFiles: ['/project/plugin/src/client.tsx'],
      generatedFiles: ['/project/plugin/src/usage-history-panel.tsx'],
      diagnostics: [],
    }))
    const streams0 = streams()
    const code = await runCli(['add', 'panel', '--id', 'usage-history', '--dry-run', '--json'], {
      io: streams0,
      runtime: { resolveConfig: async () => project(), addPreset },
    })
    expect(code).toBe(0)
    expect(addPreset).toHaveBeenCalledWith(expect.objectContaining({ preset: 'panel', id: 'usage-history', dryRun: true }))
  })
})
