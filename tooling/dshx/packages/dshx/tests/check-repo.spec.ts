import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runCli } from '../src/cli/run.js'
import { decodeJson } from '../src/json.js'

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('check repo'),
  ok: z.boolean(),
  data: z.object({
    checks: z.array(
      z.object({
        name: z.string(),
        ok: z.boolean(),
        inspected: z.number(),
        findings: z.array(z.object({ rule: z.string(), message: z.string(), file: z.string().nullable(), line: z.number().nullable(), hint: z.string() })),
      }),
    ),
  }),
})

let root: string

type DependencyMap = Readonly<Record<string, string>>
interface FixtureManifest {
  readonly scripts?: DependencyMap
  readonly dependencies?: DependencyMap
  readonly peerDependencies?: DependencyMap
}

const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}
const writePackage = (directory: string, manifest: FixtureManifest & { readonly name: string }): void =>
  write(`${directory}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`)
const writePlugin = (directory: string, name: string, manifest: FixtureManifest = {}, modules = ''): void => {
  writePackage(directory, { name, ...manifest })
  write(`${directory}/dshx.config.ts`, `import { defineConfig } from '@dshfiles/dshx'\n\nexport default defineConfig({\n  name: '${name}',${modules}\n})\n`)
}

const check = async (...args: string[]): Promise<{ readonly code: number; readonly stdout: string }> => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let output = ''
  stdout.on('data', chunk => (output += String(chunk)))
  const code = await runCli(['check', 'repo', '--cwd', root, ...args], { io: { stdin: new PassThrough(), stdout, stderr } })
  return { code, stdout: output }
}
const checkJson = async (...args: string[]) => {
  const result = await check('--json', ...args)
  return { code: result.code, envelope: decodeJson(envelopeSchema, result.stdout) }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dshx-check-repo-')))
  write('pnpm-workspace.yaml', "packages:\n  - 'plugins/*'\n")
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('dshx check repo', () => {
  it('passes a one-way workspace graph', async () => {
    writePlugin('plugins/usage', '@demo/usage', { dependencies: { '@demo/accounts': 'workspace:*', zod: '4.0.0' } })
    writePlugin('plugins/accounts', '@demo/accounts')

    const result = await check()

    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^cycles +ok \(2 packages\)$/m)
    expect(result.stdout).toMatch(/^boundaries +ok/m)
    expect(result.stdout).toMatch(/^stale-bundles +ok \(0 built packages\)$/m)
  })

  it('reports a cycle closed through a peer dependency at the package.json line', async () => {
    writePlugin('plugins/usage', '@demo/usage', { dependencies: { '@demo/accounts': 'workspace:*' } })
    writePlugin('plugins/accounts', '@demo/accounts', { peerDependencies: { '@demo/usage': 'workspace:*' } })

    const { code, envelope } = await checkJson('--only', 'cycles')

    expect(code).toBe(1)
    expect(envelope.ok).toBe(false)
    expect(envelope.data.checks.map(item => item.name)).toEqual(['cycles'])
    expect(envelope.data.checks[0]?.findings).toEqual([
      expect.objectContaining({
        rule: 'workspace-cycle',
        message: 'workspace dependency cycle: @demo/accounts ⇄ @demo/usage',
        file: 'plugins/accounts/package.json',
        line: 4,
      }),
    ])
  })

  it("reports a plugin importing another plugin's dist by relative path", async () => {
    writePlugin('plugins/usage', '@demo/usage')
    write('plugins/usage/src/host.ts', "import { readAccounts } from '../../accounts/dist/index.js'\n\nexport const host = readAccounts\n")
    writePlugin('plugins/accounts', '@demo/accounts')

    const { code, envelope } = await checkJson('--only', 'boundaries')

    expect(code).toBe(1)
    expect(envelope.data.checks[0]?.findings).toEqual([expect.objectContaining({ rule: 'relative-dist-import', file: 'plugins/usage/src/host.ts', line: 1 })])
  })

  it('reports a contract module reaching the plugin that provides it through a relative import', async () => {
    writePlugin('plugins/accounts', '@demo/accounts', {}, "\n  modules: { 'usage-view': 'src/usage-view.ts' },")
    write(
      'plugins/accounts/src/usage-view.ts',
      "import { defineContract } from '@dshfiles/dshx/client'\nimport './fallback.ts'\n\nexport const UsageView = defineContract('@demo/accounts.usage-view', {})\n",
    )
    write('plugins/accounts/src/fallback.ts', "\nimport { Dashboard } from '@demo/usage/dashboard'\n\nexport const fallback = Dashboard\n")
    writePlugin('plugins/usage', '@demo/usage', { dependencies: { '@demo/accounts': 'workspace:*' } })
    write('plugins/usage/src/client.ts', "import { UsageView } from '@demo/accounts/usage-view'\n\nexport const view = UsageView\n")

    const { envelope } = await checkJson('--only', 'boundaries')

    expect(envelope.data.checks[0]?.findings).toEqual([
      expect.objectContaining({
        rule: 'contract-imports-provider',
        message: 'contract module @demo/accounts/usage-view imports @demo/usage, which provides it',
        file: 'plugins/accounts/src/fallback.ts',
        line: 2,
      }),
    ])
  })

  it('reports a bundle older than a changed source but not a content-identical rewrite', async () => {
    const source = 'export const answer = 42\n'
    writePlugin('plugins/usage', '@demo/usage', { scripts: { build: 'dshx build' } })
    write('plugins/usage/src/host.ts', source)
    write('plugins/usage/dist/index.js', 'export const answer = 42\n')
    write(
      'plugins/usage/dist/index.js.deps.json',
      `${JSON.stringify({ version: 1, face: 'host', sources: ['src/host.ts'], hashes: { 'src/host.ts': createHash('sha256').update(source).digest('hex') } })}\n`,
    )
    const builtAt = new Date(Date.now() - 60_000)
    utimesSync(join(root, 'plugins/usage/dist/index.js'), builtAt, builtAt)
    write('plugins/usage/src/host.ts', source)

    const rewritten = await checkJson('--only', 'stale-bundles')
    expect(rewritten.code).toBe(0)
    expect(rewritten.envelope.data.checks[0]).toMatchObject({ ok: true, inspected: 1, findings: [] })

    write('plugins/usage/src/host.ts', 'export const answer = 43\n')

    const changed = await check('--only', 'stale-bundles')
    expect(changed.code).toBe(1)
    expect(changed.stdout).toContain('plugins/usage/src/host.ts  @demo/usage: dist/index.js is older than src/host.ts [source-changed]')
  })

  it('rejects an unknown check as a usage error', async () => {
    const { code, envelope } = await check('--json', '--only', 'lint').then(result => ({
      code: result.code,
      envelope: decodeJson(z.object({ ok: z.literal(false), error: z.object({ code: z.literal('usage') }) }), result.stdout),
    }))
    expect(code).toBe(2)
    expect(envelope.error.code).toBe('usage')
  })
})
