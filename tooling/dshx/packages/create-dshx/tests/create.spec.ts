import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createProject, DEFAULT_DSH_RANGE, DEFAULT_DSH_VERSION, detectPackageManager, packageVersion, validateProjectName } from '../src/index.js'
import { renderProjectTemplate } from '../src/templates.js'
import { DEFAULT_COMPATIBILITY } from '../../dshx/src/compat/index.js'
import { defaultFileSystem } from '../src/fs.js'
import { runCreate } from '../src/cli.js'
import { CORDIS_IDENTITY_DEPENDENCIES, DSH_PACKAGES } from '../src/capabilities.js'

async function temp(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), 'dshx-create-'))
}

const localDshxRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../dshx')

describe('create-dshx', () => {
  it('renders create help from its Citty command definition', async () => {
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', chunk => chunks.push(Buffer.from(chunk)))
    const exitCode = await runCreate(['--package-manager', 'pnpm', '--help'], { stdout: output, stderr: output })
    output.end()

    expect(exitCode).toBe(0)
    expect(Buffer.concat(chunks).toString()).toContain('USAGE dshx create [OPTIONS] [NAME]')
    expect(Buffer.concat(chunks).toString()).toContain('--template=<')
    expect(Buffer.concat(chunks).toString()).toContain('--package-manager=<pnpm|yarn|npm>')
  })

  it('keeps generated DSH defaults aligned with the core compatibility registry', () => {
    expect(DEFAULT_DSH_RANGE).toBe(DEFAULT_COMPATIBILITY.dshRange)
    expect(DEFAULT_DSH_VERSION).toBe(DEFAULT_COMPATIBILITY.verified.latest)
  })

  it('declares the shared Cordis identity in every generated template', () => {
    for (const template of ['basic', 'ui', 'tool', 'full-stack', 'starter', 'showcase'] as const) {
      const packageFile = renderProjectTemplate(
        {
          packageId: '@dshfiles/example',
          dshxVersion: packageVersion(),
          dshVersion: DEFAULT_DSH_VERSION,
          dshRange: DEFAULT_DSH_RANGE,
        },
        template,
        'none',
      ).find(file => file.path === 'package.json')
      if (packageFile === undefined) throw new Error(`The ${template} template did not render package.json.`)
      const manifest = JSON.parse(packageFile.contents)
      expect(manifest.devDependencies).toMatchObject(CORDIS_IDENTITY_DEPENDENCIES)
    }
  })

  it('includes the approved Host Inspect runtime plugins in every generated template', () => {
    for (const template of ['basic', 'ui', 'tool', 'full-stack', 'starter', 'showcase'] as const) {
      const packageFile = renderProjectTemplate(
        {
          packageId: '@dshfiles/example',
          dshxVersion: packageVersion(),
          dshVersion: DEFAULT_DSH_VERSION,
          dshRange: DEFAULT_DSH_RANGE,
        },
        template,
        'none',
      ).find(file => file.path === 'package.json')
      if (packageFile === undefined) throw new Error(`The ${template} template did not render package.json.`)
      const manifest = JSON.parse(packageFile.contents)
      expect(manifest.devDependencies).toMatchObject({
        [DSH_PACKAGES.cordisHostRunner]: DEFAULT_DSH_VERSION,
        [DSH_PACKAGES.toolCordis]: DEFAULT_DSH_VERSION,
      })
    }
  })

  it('includes the Slot contract and React toolchain only in Client templates', () => {
    for (const template of ['ui', 'starter', 'showcase', 'full-stack'] as const) {
      const packageFile = renderProjectTemplate(
        {
          packageId: '@dshfiles/example',
          dshxVersion: packageVersion(),
          dshVersion: DEFAULT_DSH_VERSION,
          dshRange: DEFAULT_DSH_RANGE,
        },
        template,
        'none',
      ).find(file => file.path === 'package.json')
      if (packageFile === undefined) throw new Error(`The ${template} template did not render package.json.`)
      const manifest = JSON.parse(packageFile.contents)
      expect(manifest.devDependencies).toMatchObject({
        [DSH_PACKAGES.slotContracts]: DEFAULT_DSH_VERSION,
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        '@types/react': '~18.3.31',
      })
    }
    for (const template of ['basic', 'tool'] as const) {
      const packageFile = renderProjectTemplate(
        {
          packageId: '@dshfiles/example',
          dshxVersion: packageVersion(),
          dshVersion: DEFAULT_DSH_VERSION,
          dshRange: DEFAULT_DSH_RANGE,
        },
        template,
        'none',
      ).find(file => file.path === 'package.json')
      if (packageFile === undefined) throw new Error(`The ${template} template did not render package.json.`)
      const manifest = JSON.parse(packageFile.contents)
      expect(manifest.devDependencies).not.toHaveProperty(DSH_PACKAGES.slotContracts)
    }
  })

  it('links projects to the local hard fork when this source checkout is available', async () => {
    const root = await temp()
    try {
      const result = await createProject({ name: 'local-fork-plugin', cwd: root, install: false })
      expect(result.diagnostics).toEqual([])
      const manifest = JSON.parse(await readFile(resolve(root, 'local-fork-plugin/package.json'), 'utf8'))
      const expectedLink = `link:${relative(resolve(root, 'local-fork-plugin'), localDshxRoot)}`
      expect(manifest.devDependencies['@dshfiles/dshx']).toBe(expectedLink)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the scope in generated Cordis loader ids', () => {
    const patch = renderProjectTemplate(
      {
        packageId: '@dshfiles/shortcuts',
        dshxVersion: packageVersion(),
        dshVersion: DEFAULT_DSH_VERSION,
        dshRange: DEFAULT_DSH_RANGE,
      },
      'starter',
      'none',
    ).find(file => file.path === 'cordis.patch.yml')?.contents

    expect(patch).toContain('id: dshfiles-shortcuts')
    expect(patch).not.toContain('id: shortcuts')
  })

  it('validates names and rejects existing targets before writing', async () => {
    expect(validateProjectName('Bad Name')?.code).toBe('DSHX6001')
    const root = await temp()
    await mkdir(resolve(root, 'demo'))
    const result = await createProject({ name: 'demo', cwd: root, install: false })
    expect(result.diagnostics[0]?.code).toBe('DSHX6002')
    await rm(root, { recursive: true, force: true })
  })

  it.each([
    ['starter', 'css-modules'],
    ['starter', 'tailwind'],
    ['starter', 'none'],
    ['showcase', 'css-modules'],
    ['showcase', 'tailwind'],
    ['showcase', 'none'],
  ] as const)('renders the %s + %s combination with exact files and dependencies', async (template, style) => {
    const root = await temp()
    const result = await createProject({ name: `demo-${template}-${style}`, cwd: root, install: false, template, style })
    expect(result.diagnostics).toEqual([])
    expect(result.template).toBe(template)
    expect(result.style).toBe(style)

    const relativeFiles = result.files.map(file => file.slice(result.root.length + 1)).sort()
    expect(relativeFiles).toContain('src/host.ts')
    expect(relativeFiles).toContain('src/client.tsx')
    expect(relativeFiles).toContain('dshx.config.ts')
    expect(relativeFiles.includes('src/api/status.ts')).toBe(template === 'showcase')
    expect(relativeFiles.includes('src/settings.ts')).toBe(template === 'showcase')
    expect(relativeFiles.includes('src/Plugin.module.css')).toBe(style === 'css-modules')
    expect(relativeFiles).not.toContain('src/css-modules.d.ts')
    expect(relativeFiles.includes('src/styles.css')).toBe(style === 'tailwind')
    expect(relativeFiles.some(file => file.endsWith('.css'))).toBe(style !== 'none')

    const manifest = JSON.parse(await readFile(resolve(result.root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
      peerDependencies: Record<string, string>
      scripts: Record<string, string>
      dsh: { client: { inject: string[] } }
    }
    expect(manifest.devDependencies['@dshfiles/dshx']).toBe(`link:${relative(result.root, localDshxRoot)}`)
    expect(manifest.devDependencies.typescript).toBe('^7.0.2')
    expect(manifest.devDependencies.oxlint).toBe('1.86.0')
    expect(manifest.devDependencies.oxfmt).toBe('0.71.0')
    expect(relativeFiles).toContain('.oxlintrc.json')
    expect(relativeFiles).toContain('.oxfmtrc.json')
    expect(manifest.devDependencies['@deepseek-ai/dsh']).toBe(DEFAULT_DSH_VERSION)
    expect(manifest.peerDependencies['@deepseek-ai/dsh']).toBe(DEFAULT_DSH_RANGE)
    expect(manifest.scripts).toEqual({
      check: 'dshx check && pnpm lint && pnpm fmt:check',
      typecheck: 'tsc --noEmit -p tsconfig.json',
      lint: 'oxlint src tests dshx.config.ts',
      fmt: 'oxfmt .',
      'fmt:check': 'oxfmt --check .',
      test: 'dshx test',
      build: 'dshx build',
      dev: 'dshx dev --open',
      prepack: 'npm run check && npm run build',
    })
    expect(Object.values(manifest.devDependencies).some(value => value.startsWith('workspace:'))).toBe(false)
    expect(manifest.devDependencies.tailwindcss).toBe(style === 'tailwind' ? '^4.3.3' : undefined)
    expect(manifest.devDependencies['@tailwindcss/vite']).toBe(style === 'tailwind' ? '^4.3.3' : undefined)

    const config = await readFile(resolve(result.root, 'dshx.config.ts'), 'utf8')
    expect(config).toContain("import { defineConfig } from '@dshfiles/dshx'")
    expect(config).toContain("host: { entry: 'src/host.ts' }")
    expect(config).toContain("entry: 'src/client.tsx'")
    expect(config).toContain('declarations: true')
    expect(config.includes("import tailwindcss from '@tailwindcss/vite'")).toBe(style === 'tailwind')

    const readme = await readFile(resolve(result.root, 'README.md'), 'utf8')
    expect(readme).toContain('dsh.client.inject')
    expect(readme).toContain('defineClientPlugin({ uses: [...] })')
    expect(readme).toContain('pnpm test')

    const host = await readFile(resolve(result.root, 'src/host.ts'), 'utf8')
    const client = await readFile(resolve(result.root, 'src/client.tsx'), 'utf8')
    expect(host).toContain('defineTool')
    expect(client).toContain("defineSlot('sidebar.footer.action'")
    expect(client.includes('defineLocale(')).toBe(template === 'starter')
    expect(client.includes('locales: [copy]')).toBe(template === 'starter')
    expect(client).not.toContain('declare module')
    expect(client).not.toMatch(/defineClient\(\{[^}]*\b(?:api|apis|settings)\s*:/s)
    expect(client).not.toContain('useQuery')
    expect(host.includes('definePromptSection')).toBe(template === 'showcase')
    expect(host.includes('definePromptContext')).toBe(template === 'showcase')
    expect(host.includes('settings: [runtimeSettings]')).toBe(template === 'showcase')
    expect(host.includes('apis: [statusHostApi]')).toBe(template === 'showcase')
    expect(client.includes("useApiQuery(statusApi, 'get', { enabled: true })")).toBe(template === 'showcase')
    expect(client.includes("useApiQuery(statusApi, 'refresh', {")).toBe(template === 'showcase')
    expect(client.includes('enabled: false')).toBe(template === 'showcase')
    expect(client.includes('onClick={refresh.refetch}')).toBe(template === 'showcase')
    expect(client).not.toContain('status.refetch()')
    expect(client).not.toContain('api.refresh(')
    expect(client.includes('useSettings(runtimeSettings)')).toBe(template === 'showcase')
    expect(client).not.toContain('Conversation')

    const starterProviders = ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-sidebar']
    const showcaseProviders = ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-settings']
    expect(manifest.dsh.client.inject).toEqual(template === 'showcase' ? showcaseProviders : starterProviders)
    expect(Boolean(manifest.devDependencies['@deepseek-ai/dsh-client-locale'])).toBe(template === 'starter')
    expect(Boolean(manifest.peerDependencies['@deepseek-ai/dsh-client-locale'])).toBe(template === 'starter')
    expect(Boolean(manifest.devDependencies['@deepseek-ai/dsh-client-connection'])).toBe(template === 'showcase')
    expect(Boolean(manifest.peerDependencies['@deepseek-ai/dsh-client-connection'])).toBe(template === 'showcase')
    expect(Boolean(manifest.devDependencies['@deepseek-ai/dsh-system-prompt'])).toBe(template === 'showcase')
    expect(manifest.devDependencies['@deepseek-ai/dsh-settings']).toBe(DEFAULT_DSH_VERSION)
    expect(manifest.peerDependencies['@deepseek-ai/dsh-settings']).toBe(DEFAULT_DSH_RANGE)

    if (style === 'tailwind') {
      const css = await readFile(resolve(result.root, 'src/styles.css'), 'utf8')
      expect(css).toContain('@layer theme, utilities;')
      expect(css).toContain('prefix(dshx)')
      expect(css).not.toContain('preflight.css')
      expect(client).toContain('dshx:')
      expect(client).not.toMatch(/className=\{`[^`]*\$\{/)
    }

    await rm(root, { recursive: true, force: true })
  })

  it('defaults programmatic and --yes generation to starter + css-modules', async () => {
    const root = await temp()
    const direct = await createProject({ name: 'direct-default', cwd: root, install: false })
    expect(direct.template).toBe('starter')
    expect(direct.style).toBe('css-modules')
    expect(await readFile(resolve(direct.root, 'src/Plugin.module.css'), 'utf8')).toContain('.card')

    const output = new PassThrough()
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    input.isTTY = false
    await expect(runCreate(['cli-default', '--cwd', root, '--no-install', '--yes'], { stdin: input, stdout: output, stderr: output })).resolves.toBe(0)
    expect(await readFile(resolve(root, 'cli-default/src/Plugin.module.css'), 'utf8')).toContain('.card')
    await rm(root, { recursive: true, force: true })
  })

  it('detects project lockfiles before PATH commands', async () => {
    const root = await temp()
    await writeFile(resolve(root, 'yarn.lock'), '')
    const runner = async (): Promise<{ exitCode: number }> => ({ exitCode: 0 })
    await expect(detectPackageManager(root, defaultFileSystem, runner)).resolves.toBe('yarn')
    await rm(root, { recursive: true, force: true })
  })

  it('uses packageManager metadata before PATH and keeps PATH priority stable', async () => {
    const root = await temp()
    await writeFile(resolve(root, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.9.4' }))
    const runner = async (): Promise<{ exitCode: number }> => ({ exitCode: 0 })
    await expect(detectPackageManager(root, defaultFileSystem, runner)).resolves.toBe('yarn')

    const fs = {
      ...defaultFileSystem,
      exists: async (): Promise<boolean> => false,
    }
    const calls: string[] = []
    const pathRunner = async (_command: string, args: readonly string[]): Promise<{ exitCode: number }> => {
      calls.push(args[0] ?? '')
      return { exitCode: args[0] === 'pnpm' ? 0 : 1 }
    }
    await expect(detectPackageManager(root, fs, pathRunner, {})).resolves.toBe('pnpm')
    expect(calls).toEqual(['pnpm'])
    await rm(root, { recursive: true, force: true })
  })

  it('uses the invoking package manager before PATH fallback', async () => {
    const root = await temp()
    const calls: string[] = []
    const runner = async (command: string): Promise<{ exitCode: number }> => {
      calls.push(command)
      return { exitCode: 0 }
    }
    await expect(
      detectPackageManager(root, defaultFileSystem, runner, {
        npm_config_user_agent: 'npm/11.6.0 node/v25.8.1 darwin arm64',
      }),
    ).resolves.toBe('npm')
    expect(calls).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('reports dependency installation progress around the selected manager', async () => {
    const root = await temp()
    const events: string[] = []
    const runner = async (command: string): Promise<{ exitCode: number }> => ({
      exitCode: command === 'npm' ? 0 : 1,
    })
    const result = await createProject(
      {
        name: 'progress-demo',
        cwd: root,
        packageManager: 'npm',
        onInstallProgress: event => events.push(`${event.phase}:${event.packageManager}`),
      },
      { runner },
    )
    expect(result.installed).toBe(true)
    expect(events).toEqual(['start:npm', 'success:npm'])
    await rm(root, { recursive: true, force: true })
  })

  it('renders live install progress in an interactive terminal', async () => {
    const root = await temp()
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', chunk => chunks.push(Buffer.from(chunk)))
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    input.isTTY = true
    const runner = async (): Promise<{ exitCode: number }> => {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 150))
      return { exitCode: 0 }
    }
    await expect(
      runCreate(['spinner-demo', '--cwd', root, '--yes', '--package-manager', 'npm'], { stdin: input, stdout: output, stderr: output }, { runner }),
    ).resolves.toBe(0)
    const rendered = Buffer.concat(chunks).toString()
    expect(rendered).toContain('Installing dependencies with npm')
    expect(rendered).toContain('Dependencies installed with npm')
    await rm(root, { recursive: true, force: true })
  })

  it('keeps an explicit package manager ahead of project detection', async () => {
    const root = await temp()
    const calls: string[] = []
    const runner = async (command: string): Promise<{ exitCode: number }> => {
      calls.push(command)
      return { exitCode: 0 }
    }
    const result = await createProject({ name: 'demo', cwd: root, packageManager: 'npm' }, { runner })
    expect(result.packageManager).toBe('npm')
    expect(calls).toEqual(['npm'])
    await rm(root, { recursive: true, force: true })
  })

  it('keeps generated files when installation fails', async () => {
    const root = await temp()
    const runner = async (command: string): Promise<{ exitCode: number }> => ({ exitCode: command === 'which' ? 0 : 1 })
    const result = await createProject({ name: 'demo', cwd: root }, { runner })
    expect(result.diagnostics[0]?.code).toBe('DSHX6004')
    expect(result.files).not.toHaveLength(0)
    await rm(root, { recursive: true, force: true })
  })

  it('accepts injected CLI IO for generation tests', async () => {
    const root = await temp()
    const output = new PassThrough()
    const chunks: Buffer[] = []
    output.on('data', chunk => chunks.push(Buffer.from(chunk)))
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    input.isTTY = false
    await expect(runCreate(['demo', '--cwd', root, '--no-install', '--yes'], { stdin: input, stdout: output, stderr: output })).resolves.toBe(0)
    expect(Buffer.concat(chunks).toString()).toContain('Created demo')
    await rm(root, { recursive: true, force: true })
  })

  it('accepts CLI selectors and asks both choices in interactive mode', async () => {
    const root = await temp()
    const output = new PassThrough()
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    input.isTTY = true
    const answers = ['showcase', 'tailwind']
    const questions: string[] = []
    const readLine = async (question: string): Promise<string> => {
      questions.push(question)
      return answers.shift() ?? ''
    }
    await expect(runCreate(['interactive-demo', '--cwd', root, '--no-install'], { stdin: input, stdout: output, stderr: output, readLine })).resolves.toBe(0)
    expect(questions).toEqual(['Project template (basic/ui/tool/full-stack): ', 'Client style (css-modules/tailwind/none): '])
    expect(await readFile(resolve(root, 'interactive-demo/src/api/status.ts'), 'utf8')).toContain('defineApi')
    expect(await readFile(resolve(root, 'interactive-demo/src/styles.css'), 'utf8')).toContain('prefix(dshx)')

    await expect(runCreate(['bad', '--template', 'full', '--no-install'], { stdin: input, stdout: output, stderr: output })).resolves.toBe(2)
    await expect(runCreate(['bad', '--style', 'sass', '--no-install'], { stdin: input, stdout: output, stderr: output })).resolves.toBe(2)
    await rm(root, { recursive: true, force: true })
  })

  it('requires a name in non-interactive mode instead of reading stdin', async () => {
    const output = new PassThrough()
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    input.isTTY = false
    await expect(runCreate(['--yes'], { stdin: input, stdout: output, stderr: output })).resolves.toBe(2)
  })
})
