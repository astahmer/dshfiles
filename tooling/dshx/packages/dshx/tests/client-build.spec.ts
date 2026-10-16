import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Plugin } from 'vite'
import { buildClient, watchClient } from '../src/compiler/index.js'
import { writePluginFixture } from './plugin-fixture.js'

const temporaryDirectories: string[] = []

const clientPluginShape = z.object({ name: z.string(), inject: z.array(z.string()), apply: z.function({ input: [z.unknown()], output: z.unknown() }) })
const isClientPlugin = (value: unknown): value is z.infer<typeof clientPluginShape> => clientPluginShape.safeParse(value).success

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'dshx-fixture-'))
  temporaryDirectories.push(directory)
  await writePluginFixture(directory)
  const clientEntry = resolve(directory, 'src/client.tsx')
  await writeFile(clientEntry, (await readFile(clientEntry, 'utf8')).replaceAll('useQuery', 'useApiQuery'))
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
describe('client compiler', () => {
  it('embeds an explicit owned Client dependency while preserving platform identities', async () => {
    const root = await temporaryProject()
    const dependencyRoot = resolve(root, 'node_modules/@deepseek-ai/dsh-owned-client')
    await mkdir(dependencyRoot, { recursive: true })
    await writeFile(resolve(dependencyRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-owned-client', type: 'module', exports: './index.js' }))
    await writeFile(resolve(dependencyRoot, 'index.js'), 'export const ownedValue = "owned-client-value"')
    await writeFile(
      resolve(root, 'src/client.tsx'),
      "import { defineClient } from '@dshfiles/dshx/client'; import { ownedValue } from '@deepseek-ai/dsh-owned-client'; export default defineClient({ setup() { globalThis.console.log(ownedValue) } })",
    )
    const options = { packageId: '@dshx/fixture-plugin', root, entry: 'src/client.tsx', outDir: 'dist' }
    await expect(buildClient(options)).rejects.toThrow('DSHX1202')
    await buildClient({ ...options, bundleDependencies: ['@deepseek-ai/dsh-owned-client'] })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).toContain('owned-client-value')
    expect(code).not.toContain('require("@deepseek-ai/dsh-owned-client")')
    await expect(buildClient({ ...options, bundleDependencies: ['@deepseek-ai/cordis'] })).rejects.toMatchObject({ code: 'DSHX4004' })
  })

  it('emits one lazy-CJS bundle with external React, owned CSS, and a TSX sourcemap', async () => {
    const root = await temporaryProject()
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
    })

    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    const map = JSON.parse(await readFile(resolve(root, 'dist/client.js.map'), 'utf8')) as {
      sources: string[]
      sourcesContent?: Array<string | null>
    }
    expect(code).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id: "@dshx\/fixture-plugin"/)
    expect(code).not.toContain(JSON.stringify(root))
    expect(JSON.stringify(map)).not.toContain(root)
    expect(code).toContain('src/client.tsx')
    expect(code).toContain('require("react/jsx-runtime")')
    expect(code).not.toContain('react.production.min')
    expect(code).toMatch(/sourceMappingURL=client\.js\.map/)
    expect(map.sources.some(source => source.endsWith('/src/client.tsx') || source.endsWith('src/client.tsx'))).toBe(true)
    expect(map.sourcesContent?.some(source => source?.includes('Build. Ship. Observe.') === true)).toBe(true)

    let registration:
      | {
          id: string
          factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
        }
      | undefined
    const styles: Array<{
      dataset: Record<string, string>
      textContent: string
    }> = []
    const document = {
      querySelector: (selector: string) => {
        const match = /^style\[data-([\w-]+)="(.*)"\]$/.exec(selector)
        const key = match?.[1]?.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
        return styles.find(style => key !== undefined && style.dataset[key] === match?.[2]) ?? null
      },
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: {
        appendChild: (style: { dataset: Record<string, string>; textContent: string }) => styles.push(style),
      },
    }
    vm.runInNewContext(code, {
      document,
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => {
            registration = value
          },
        },
      },
    })
    expect(registration?.id).toBe('@dshx/fixture-plugin')
    expect(styles).toHaveLength(0)

    const requireModule = (id: string): unknown => {
      if (id === 'react') {
        const context = { Provider: 'provider' }
        return {
          createContext: () => context,
          createElement: (type: unknown, props: unknown, child: unknown) => ({
            type,
            props: { ...(props as object), children: child },
          }),
          useContext: () => undefined,
          useEffect: () => undefined,
          useMemo: (factory: () => unknown) => factory(),
          useState: (value: unknown) => [value, () => undefined],
        }
      }
      if (id === 'react/jsx-runtime') {
        return {
          jsx: (type: unknown, props: unknown) => ({ type, props }),
          jsxs: (type: unknown, props: unknown) => ({ type, props }),
        }
      }
      throw new Error(`unexpected require: ${id}`)
    }
    const plugin = registration?.factory(requireModule)
    registration?.factory(requireModule)
    expect(styles).toHaveLength(2)
    const [marker, sheet] = styles
    expect(marker?.dataset.plugin).toBe('@dshx/fixture-plugin')
    expect(marker?.dataset.pluginCss).toBe('@dshx/fixture-plugin/client.css')
    expect(marker?.textContent).toBe('')
    expect(sheet?.dataset.plugin).toBe('dshx:shared-css')
    expect(sheet?.dataset.dshxSharedCss).toBe(marker?.dataset.dshxCss)
    expect(sheet?.textContent).toContain('background: #101b2a')
    const registered: unknown[] = []
    if (!isClientPlugin(plugin)) throw new Error('The built client module did not export a Client plugin.')
    expect(plugin.name).toBe('@dshx/fixture-plugin')
    expect(plugin.inject).toEqual(['slots', 'connection'])
    await plugin.apply({
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (options: unknown, component: unknown) => {
          registered.push({ options, component })
          return component
        },
      },
    })
    expect(registered).toHaveLength(1)
    const component = (
      registered[0] as {
        component: () => {
          type: unknown
          props: { children: { type: string; props: { className: string } } }
        }
      }
    ).component
    const element = component()
    expect(element.type).toBe('provider')
    expect(typeof element.props.children.type).toBe('function')
  })

  it('adapts a defineClient default export and keeps the logical name in the bundle', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'export default defineClient({',
        "  name: 'explicit-client',",
        "  inject: ['remote', 'remote'],",
        '  setup() {},',
        '})',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'logical-client',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toMatch(/(?:from|require)\(["']dshx\/client/)
    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    const plugin = registration.factory(() => ({})) as {
      name: string
      inject: string[]
    }
    expect(plugin.name).toBe('explicit-client')
    expect(plugin.inject).toEqual(['remote'])
  })

  it('fails before runtime when setup uses locale without a defineClient service injection', async () => {
    const root = await temporaryProject()
    const entry = resolve(root, 'src/client.tsx')
    await writeFile(
      entry,
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export default defineClient({ inject: ['slots'], setup(ctx) { ctx.locale.register('demo', {}) } })",
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-locale'],
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1204',
      file: expect.stringContaining('/src/client.tsx'),
      hint: expect.stringContaining('defineClient'),
    })
  })

  it('requires the Locale provider package edge for declarative locale contributions', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient, defineLocale } from '@dshfiles/dshx/client'",
        "const copy = defineLocale('demo', { zh: { title: '标题' }, en: { title: 'Title' } })",
        "export default defineClient({ locales: [copy], setup({ locale }) { locale.bind('demo') } })",
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1203',
      hint: expect.stringContaining('@deepseek-ai/dsh-client-locale'),
    })

    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-locale'],
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    expect((registration.factory(() => ({})) as { inject: string[] }).inject).toEqual(['locale', 'slots'])
  })

  it('builds declarative locales through the virtual Client API without a duplicate service injection', async () => {
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

    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1203',
      message: expect.stringContaining('defineLocale'),
      hint: expect.stringContaining('@deepseek-ai/dsh-client-locale'),
    })

    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-locale'],
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain("require('@deepseek-ai/dsh-client-locale")
    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    const plugin = registration.factory(() => ({})) as {
      inject: string[]
      apply(ctx: unknown): unknown
    }
    expect(plugin.inject).toEqual(['locale', 'slots'])
    const register = vi.fn(() => vi.fn())
    const bind = vi.fn()
    plugin.apply({
      effect: (callback: () => unknown) => callback(),
      locale: { register, bind },
    })
    expect(register).toHaveBeenCalledWith('demo', {
      zh: { title: '标题' },
      en: { title: 'Title' },
    })
    expect(bind).toHaveBeenCalledWith('demo')
  })

  it('fails the build when a dock reuses a shipped Slot id', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'const Dock = (): null => null',
        'export default defineClient({ inject: ["slots"], setup(ctx) { ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "queue", order: 20 }, Dock)) } })',
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/phase-a-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-ui-conversation'],
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1206',
      message: expect.stringContaining('conversation.input.dock'),
      file: expect.stringContaining('/src/client.tsx'),
    })
  })

  it('fails the build when a Client replaces the sidebar shell without a registration key', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'const Sidebar = (): null => null',
        "export default defineClient({ inject: ['slots'], setup(ctx) { ctx.slots.register({ name: 'sidebar' }, Sidebar) } })",
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/sidebar-replacement-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1206',
      message: expect.stringContaining('ui-sidebar'),
      hint: expect.stringContaining('inner Slots'),
    })
  })

  it('accepts a dock that takes a distinct Slot id', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'const Dock = (): null => null',
        'export default defineClient({ inject: ["slots"], setup(ctx) { ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "fixture-dock", order: 21 }, Dock)) } })',
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/phase-a-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-ui-conversation'],
      }),
    ).resolves.toEqual(expect.objectContaining({ face: 'client' }))
  })

  it('finds Slot registrations that a Client entry reaches through its imports', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "import { registerDock } from './dock.js'",
        'export default defineClient({ inject: ["slots"], setup(ctx) { registerDock(ctx) } })',
        '',
      ].join('\n'),
    )
    await writeFile(
      resolve(root, 'src/dock.ts'),
      [
        'const Dock = (): null => null',
        'export const registerDock = (ctx: { slots: { inject: (slot: string, register: () => unknown) => void } }): void => {',
        '  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "queue" }, Dock))',
        '}',
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/phase-a-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-ui-conversation'],
      }),
    ).rejects.toMatchObject({ code: 'DSHX1206' })
  })

  it('permits reusing a shipped id when the entry declares a shadowing priority', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'export default defineClient({ inject: ["slots"], setup(ctx) {',
        '  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({ name: "conversation.input.dock", id: "queue", priority: -1 }, Dock))',
        '} })',
        'const Dock = (): null => null',
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/phase-a-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-ui-conversation'],
      }),
    ).resolves.toEqual(expect.objectContaining({ face: 'client' }))
  })

  it('fails before runtime when setup uses ctx.sessions without declaring it', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient } from '@dshfiles/dshx/client'", 'export default defineClient({ setup(ctx) { ctx.sessions.scope("s") } })', ''].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/phase-a-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-api-session-controller'],
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1204',
      hint: expect.stringContaining('defineClient'),
    })
  })

  it('requires the provider package edge for every declared setup service', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'export default defineClient({ inject: ["slots", "sessions"], setup(ctx) { ctx.sessions.scope("s"); ctx.slots.inject("main", () => null) } })',
        '',
      ].join('\n'),
    )

    await expect(
      buildClient({
        packageId: '@dshx/phase-a-fixture',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-ui-conversation'],
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1203',
      hint: expect.stringContaining('@deepseek-ai/dsh-api-session-controller'),
    })
  })

  it('accepts a setup that declares the services it uses', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'export default defineClient({ inject: ["slots", "sessions"], setup(ctx) { ctx.sessions.scope("s"); ctx.slots.inject("main", () => null) } })',
        '',
      ].join('\n'),
    )

    await buildClient({
      packageId: '@dshx/phase-a-fixture',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-ui-conversation'],
    })
    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(await readFile(resolve(root, 'dist/client.js'), 'utf8'), {
      window: { __ModuleLoader__: { load: (value: typeof registration) => Object.assign(registration, value) } },
    })
    expect((registration.factory(() => ({})) as { inject: string[] }).inject).toEqual(['slots', 'sessions'])
  })

  it('applies the same setup-service validation to the dev watcher', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient } from '@dshfiles/dshx/client'", "export default defineClient({ inject: ['slots'], setup(ctx) { return ctx.locale } })", ''].join(
        '\n',
      ),
    )
    await expect(
      watchClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-locale'],
      }),
    ).rejects.toMatchObject({ code: 'DSHX1204' })
  })

  it('does not infer setup services when a later object spread can replace setup', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        'const dynamic = Math.random() > 2 ? { setup() {} } : {}',
        'export default defineClient({ setup(ctx) { return ctx.locale }, ...dynamic })',
        '',
      ].join('\n'),
    )
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-ui-conversation'],
      }),
    ).resolves.toEqual(expect.objectContaining({ face: 'client' }))
  })

  it('fails a retained Conversation component without its official provider package edge', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "const contribution = { marker: 'dshx.conversation-component.v1' }",
        'export default defineClient({ conversations: [contribution] })',
        '',
      ].join('\n'),
    )
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: [],
      }),
    ).rejects.toMatchObject({
      code: 'DSHX1203',
      hint: expect.stringContaining('@deepseek-ai/dsh-client-ui-conversation'),
    })
  })

  it('does not require Conversation provider edges when a component contract is tree-shaken', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "import { defineConversation } from '@dshfiles/dshx/experimental/conversation'",
        'void defineConversation',
        'export default defineClient({ setup() {} })',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
  })

  it('does not require Conversation provider edges for a retained contract without a component contribution', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "import { defineConversation } from '@dshfiles/dshx/experimental/conversation'",
        'const review = defineConversation({',
        "  kind: 'review-job',",
        "  events: { 'review/job-started': { role: 'start', id: () => 'review-job' } },",
        '})',
        'export default defineClient({ name: review.kind })',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
  })

  it('does not require Conversation provider edges for an empty contribution list', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient } from '@dshfiles/dshx/client'", 'export default defineClient({ conversations: [] })', ''].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
  })

  it('resolves an indirect defineClient config before requiring Conversation providers', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "const config = { name: 'indirect-client', slots: [] }",
        'export default defineClient(config)',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
  })

  it('embeds the same API contract validation in the lazy Client factory', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        "import { defineClient } from '@dshfiles/dshx/client'",
        "const invalid = defineApi({ id: 'invalid/id', version: 1, methods: { get: method() } })",
        'export default defineClient({ api: invalid })',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    expect(() => registration.factory(() => ({}))).toThrow('Invalid API id')
    expect(code).not.toContain('@dshfiles/dshx/api')
  })

  it('embeds the package Loader row ids as Plugins page settings namespaces', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.tsx'), "import { defineClient } from '@dshfiles/dshx/client'; export default defineClient({})")
    const options = { packageId: '@dshx/fixture-plugin', root, entry: 'src/client.tsx', outDir: 'dist' }
    await buildClient(options)
    expect(await readFile(resolve(root, 'dist/client.js'), 'utf8')).toMatch(/"pluginPageNamespaces":\s*\[\s*"dshx-fixture"\s*\]/)

    await writeFile(
      resolve(root, 'src/client.tsx'),
      "export const inject = ['slots']; export function apply(ctx) { ctx.slots.register({ name: 'plugins.bundle.config', key: '@dshx/fixture-plugin' }, () => null) }",
    )
    await buildClient(options)
    expect(await readFile(resolve(root, 'dist/client.js'), 'utf8')).toMatch(/"pluginPageNamespaces":\s*\[\]/)
  })

  it('refuses a dsh.client.inject edge one typo away from an installed package', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.tsx'), "import { defineClient } from '@dshfiles/dshx/client'; export default defineClient({})")
    const options = { packageId: '@dshx/fixture-plugin', root, entry: 'src/client.tsx', outDir: 'dist' }
    await expect(buildClient({ ...options, inject: ['@deepseek-ai/dsh-client-ui-setings'] })).rejects.toMatchObject({
      code: 'DSHX1207',
      message: expect.stringContaining('"@deepseek-ai/dsh-client-ui-settings"'),
    })
    await expect(buildClient({ ...options, inject: ['@deepseek-ai/dsh-client-ui-settings', '@acme/provider-from-the-installation'] })).resolves.toBeDefined()
  })

  it('preserves native named Client exports and Config', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "export const name = 'native-client'",
        "export const inject = ['slots']",
        'export const Config = { marker: true }',
        'export function apply(ctx, config) { ctx.received = config }',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      logicalName: 'logical-client',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    const plugin = registration.factory(() => ({})) as {
      name: string
      inject: string[]
      Config: unknown
      apply: (ctx: { received?: unknown }, config: unknown) => void
    }
    const context: { received?: unknown } = {}
    const config = { enabled: true }
    plugin.apply(context, config)
    expect(plugin.name).toBe('native-client')
    expect(plugin.inject).toEqual(['slots'])
    expect(plugin.Config).toEqual({ marker: true })
    expect(context.received).toBe(config)
  })

  it('rejects a Node builtin in the client graph', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.tsx'), "import { readFile } from 'node:fs/promises'\nexport const apply = readFile\n")
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toThrow('DSHX1201')
  })

  it('rejects an undeclared DSH value import', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.tsx'), "import value from '@deepseek-ai/dsh-client-ui-layout/client'\nexport const apply = value\n")
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toThrow('DSHX1202')
  })

  it('preserves an explicitly declared module request as an exact require', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.tsx'), "import { marker } from '@deepseek-ai/dsh-client-ui-layout/client'\nexport const apply = marker\n")
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      external: ['@deepseek-ai/dsh-client-ui-layout/client'],
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).toContain('require("@deepseek-ai/dsh-client-ui-layout/client")')
  })

  it('infers settingsScope from a retained useSettings hook after tree-shaking', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient, defineSlot, useSettings } from '@dshfiles/dshx/client'",
        "import { defineSettings } from '@dshfiles/dshx/settings'",
        "const schema = Object.assign(value => value, { toJSON: () => ({ type: 'object' }) })",
        "const settings = defineSettings({ namespace: 'fixture', schema })",
        'function Status() {',
        '  const state = useSettings(settings)',
        '  return <div>{String(state.value)}</div>',
        '}',
        "export default defineClient({ slots: [defineSlot('status', { component: Status })] })",
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-ui-settings'],
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain('dshx.settings-hook.v1')
    expect(code).toContain('settingsCapability: true')
    expect(code).not.toContain('@dshfiles/dshx/settings')

    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    const plugin = registration.factory(id => {
      if (id === 'react') return {}
      if (id === 'react/jsx-runtime') return {}
      throw new Error(`unexpected require: ${id}`)
    }) as { inject: string[] }
    expect(plugin.inject).toEqual(['slots', 'configForms'])
  })

  it('does not infer Settings when an imported hook is removed by tree-shaking', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient, useSettings } from '@dshfiles/dshx/client'", 'void useSettings', 'export default defineClient({ setup() {} })', ''].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain('dshx.settings-hook.v1')
    expect(code).toContain('settingsCapability: false')
  })

  it('fails a retained Settings hook without its official provider package edge', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient, useSettings } from '@dshfiles/dshx/client'",
        "const contract = { namespace: 'fixture' }",
        'function Status() { useSettings(contract); return null }',
        'export default defineClient({ setup() { return Status() } })',
        '',
      ].join('\n'),
    )
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toThrow('DSHX1203')
  })

  it('keeps the ModuleLoader protocol and inferred capabilities in a minified build', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        "import { defineClient, defineSlot, useApi } from '@dshfiles/dshx/client'",
        "const status = defineApi({ id: 'status', version: 1, methods: { get: method() } })",
        'function Status() { useApi(status); return null }',
        "export default defineClient({ slots: [defineSlot('status', { component: Status })] })",
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
      minify: true,
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain('__DSHX_CLIENT_API_CAPABILITY__')
    expect(code).not.toContain('__DSHX_CLIENT_SETTINGS_CAPABILITY__')
    expect(code).toMatch(/apiCapability:(?:true|!0)/)
    expect(code).not.toContain('\n  ')
  })

  it('folds CSS into a minified factory before its return', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.css'), '.fixture-root { color: red; }\n')
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import './client.css'", "import { defineClient } from '@dshfiles/dshx/client'", 'export default defineClient({})', ''].join('\n'),
    )
    await buildClient({ packageId: '@dshx/fixture-plugin', root, entry: 'src/client.tsx', outDir: 'dist', minify: true })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).toMatch(/fixture-root[^]*return [^;{}]*\.exports\}\}\)/)
  })

  it('infers Connection from a retained useApi hook without Client api/apis', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        "import { defineClient, defineSlot, useApi } from '@dshfiles/dshx/client'",
        "const status = defineApi({ id: 'status', version: 1, methods: { get: method() } })",
        'function Status() { useApi(status); return null }',
        "export default defineClient({ slots: [defineSlot('status', { component: Status })] })",
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain('dshx.api-hook.v1')
    expect(code).toContain('apiCapability: true')
    expect(code).not.toContain('@dshfiles/dshx/api')
    expect(code).not.toContain('@dshfiles/dshx/client')
    expect(code).not.toMatch(/require\(["']@deepseek-ai\/dsh-client-connection(?:\/client)?["']\)/)

    const registration: {
      factory: (requireModule: (id: string) => unknown) => Record<string, unknown>
    } = {} as never
    vm.runInNewContext(code, {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => Object.assign(registration, value),
        },
      },
    })
    const plugin = registration.factory(() => ({})) as { inject: string[] }
    expect(plugin.inject).toEqual(['slots', 'connection'])
  })

  it('infers Connection when useApiQuery retains useApi internally', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        "import { defineClient, defineSlot, useApiQuery } from '@dshfiles/dshx/client'",
        "const status = defineApi({ id: 'status', version: 1, methods: { get: method() } })",
        "function Status() { useApiQuery(status, 'get'); return null }",
        "export default defineClient({ slots: [defineSlot('status', { component: Status })] })",
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain('dshx.api-hook.v1')
    expect(code).toContain('apiCapability: true')
  })

  it('does not infer API capability from an import removed by tree-shaking', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      ["import { defineClient, useApi } from '@dshfiles/dshx/client'", 'void useApi', 'export default defineClient({ setup() {} })', ''].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).not.toContain('dshx.api-hook.v1')
    expect(code).toContain('apiCapability: false')
  })

  it('derives capabilities from retained module metadata rather than marker-like user strings', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export const labels = ['dshx.api-hook.v1', 'dshx.settings-hook.v1']",
        'export default defineClient({ setup() { return labels.length } })',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
    expect(code).toContain('dshx.api-hook.v1')
    expect(code).toContain('apiCapability: false')
    expect(code).toContain('settingsCapability: false')
  })

  it('runs user transforms inside the bounded Vite kernel', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/client.tsx'), "export const name = 'transform-before'\nexport function apply() {}\n")
    const plugin: Plugin = {
      name: 'test-transform',
      transform(code, id) {
        return id.endsWith('/src/client.tsx') ? code.replace('transform-before', 'transform-after') : null
      },
    }
    const report = await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      vite: { plugins: [[false, plugin]] },
    })
    expect(await readFile(resolve(root, 'dist/client.js'), 'utf8')).toContain('transform-after')
    expect(report).toMatchObject({ face: 'client', entryFile: 'client.js' })
    expect(report.output).toEqual(expect.arrayContaining([{ fileName: 'client.d.ts', type: 'declaration' }]))
    expect(await readFile(resolve(root, 'dist/client.d.ts'), 'utf8')).toContain('export declare function apply(ctx: Context')
  })

  it('inlines local resources and leaves no standalone assets', async () => {
    const root = await temporaryProject()
    await writeFile(resolve(root, 'src/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="2"/></svg>')
    await writeFile(resolve(root, 'src/client.tsx'), "import icon from './icon.svg'\nexport const name = icon\nexport function apply() {}\n")
    const report = await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    expect(await readFile(resolve(root, 'dist/client.js'), 'utf8')).toContain('data:image/svg+xml')
    expect(report.output.filter(item => item.type === 'asset' && !item.fileName.endsWith('.map'))).toEqual([])
  })

  it('rejects protected config overrides and unsupported emitted assets', async () => {
    const root = await temporaryProject()
    const override: Plugin = {
      name: 'override-target',
      config: () => ({ build: { target: 'es2018' } }),
    }
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        vite: { plugins: [override] },
      }),
    ).rejects.toThrow('DSHX1403')

    const emit: Plugin = {
      name: 'emit-asset',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'unsupported.txt',
          source: 'nope',
        })
      },
    }
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-connection'],
        vite: { plugins: [emit] },
      }),
    ).rejects.toThrow('DSHX1102')

    const corrupt: Plugin = {
      name: 'corrupt-client-protocol',
      renderChunk: () => 'module.exports = {}',
    }
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-connection'],
        vite: { plugins: [corrupt] },
      }),
    ).rejects.toThrow('DSHX1101')
  })

  it('rejects dev-server-only plugins from build-watch', async () => {
    const root = await temporaryProject()
    await expect(
      watchClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        vite: { plugins: [{ name: 'serve-only', apply: 'serve' }] },
      }),
    ).rejects.toThrow('DSHX1402')
  })

  it('allows a build plugin to expose an unused configureServer hook', async () => {
    const root = await temporaryProject()
    const configureServer = vi.fn()
    const watcher = await watchClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
      vite: {
        plugins: [
          {
            name: 'build-with-optional-server-hook',
            configureServer,
            transform: () => null,
          },
        ],
      },
    })
    await watcher.close()
    expect(configureServer).not.toHaveBeenCalled()
  })

  it('fails a retained API hook without its official provider package edge', async () => {
    const root = await temporaryProject()
    await writeFile(
      resolve(root, 'src/client.tsx'),
      [
        "import { defineApi, method } from '@dshfiles/dshx/api'",
        "import { defineClient, useApi } from '@dshfiles/dshx/client'",
        "const status = defineApi({ id: 'status', version: 1, methods: { get: method() } })",
        'function Status() { useApi(status); return null }',
        'export default defineClient({ setup() { return Status() } })',
        '',
      ].join('\n'),
    )
    await expect(
      buildClient({
        packageId: '@dshx/fixture-plugin',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
      }),
    ).rejects.toThrow('DSHX1203')
  })

  it('shares supplier modules and the supplier sheet through the module table', async () => {
    const project = async (name: string, client: string, external: readonly string[]): Promise<string> => {
      const root = await mkdtemp(resolve(tmpdir(), 'dshx-shared-'))
      temporaryDirectories.push(root)
      await mkdir(resolve(root, 'src'), { recursive: true })
      await mkdir(resolve(root, 'node_modules/shared-lib'), { recursive: true })
      await writeFile(
        resolve(root, 'package.json'),
        JSON.stringify({ name, version: '0.0.0', type: 'module', dsh: { client: { platform: 'web', inject: [], external } } }),
      )
      await writeFile(resolve(root, 'node_modules/shared-lib/package.json'), JSON.stringify({ name: 'shared-lib', type: 'module', exports: './index.js' }))
      await writeFile(resolve(root, 'node_modules/shared-lib/index.js'), `export const named = 'named-from-${name}'\nexport default 'default-from-${name}'\n`)
      await writeFile(resolve(root, 'src/client.css'), '.shared-sheet { color: #123456 }\n')
      await writeFile(resolve(root, 'src/client.ts'), client)
      return root
    }
    const supplierRoot = await project(
      '@dshx/shared-runtime',
      "import { defineClient } from '@dshfiles/dshx/client'\nimport './client.css'\nexport default defineClient({ setup() {} })\n",
      [],
    )
    await buildClient({ packageId: '@dshx/shared-runtime', root: supplierRoot, entry: 'src/client.ts', outDir: 'dist', sharedRuntime: ['shared-lib'] })
    const manifest = JSON.parse(await readFile(resolve(supplierRoot, 'dist/shared-runtime.json'), 'utf8')) as {
      supplier: string
      modules: Record<string, string[]>
      cssHash: string
    }
    expect(manifest).toMatchObject({ supplier: '@dshx/shared-runtime', modules: { 'shared-lib': ['default', 'named'] } })
    expect(manifest.cssHash).toMatch(/^[0-9a-f]{16}$/)

    const consumerClient = [
      "import { defineClient } from '@dshfiles/dshx/client'",
      "import fallback, { named } from 'shared-lib'",
      "import './client.css'",
      'globalThis.probe = [fallback, named]',
      'export default defineClient({ setup() {} })',
      '',
    ].join('\n')
    const consumerRoot = await project('@dshx/consumer', consumerClient, ['@dshx/shared-runtime'])
    await mkdir(resolve(consumerRoot, 'node_modules/@dshx'), { recursive: true })
    await symlink(supplierRoot, resolve(consumerRoot, 'node_modules/@dshx/shared-runtime'), 'dir')
    const consumerOptions = { packageId: '@dshx/consumer', root: consumerRoot, entry: 'src/client.ts', outDir: 'dist', shared: '@dshx/shared-runtime' }
    await expect(buildClient(consumerOptions)).rejects.toMatchObject({ code: 'DSHX1208' })
    await buildClient({ ...consumerOptions, external: ['@dshx/shared-runtime'] })
    const consumerCode = await readFile(resolve(consumerRoot, 'dist/client.js'), 'utf8')
    expect(consumerCode).toContain('require("@dshx/shared-runtime")')
    expect(consumerCode).not.toContain('named-from-@dshx/consumer')
    expect(consumerCode).not.toContain('#123456')

    const factories = new Map<string, (requireModule: (id: string) => unknown) => unknown>()
    const materialized = new Map<string, unknown>()
    const requireModule = (id: string): unknown => {
      if (!materialized.has(id)) materialized.set(id, factories.get(id)?.(requireModule))
      return materialized.get(id)
    }
    const styles: Array<{ dataset: Record<string, string>; textContent: string }> = []
    const sandbox = {
      document: {
        querySelector: (selector: string) => {
          const match = /^style\[data-([\w-]+)="(.*)"\]$/.exec(selector)
          const key = match?.[1]?.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
          return styles.find(style => key !== undefined && style.dataset[key] === match?.[2]) ?? null
        },
        createElement: () => ({ dataset: {}, textContent: '' }),
        head: { appendChild: (style: { dataset: Record<string, string>; textContent: string }) => styles.push(style) },
      },
      window: {
        __ModuleLoader__: {
          load: (value: { id: string; factory: (requireModule: (id: string) => unknown) => unknown }) => factories.set(value.id, value.factory),
        },
      },
      globalThis: {},
    }
    sandbox.globalThis = sandbox
    vm.runInNewContext(await readFile(resolve(supplierRoot, 'dist/client.js'), 'utf8'), sandbox)
    vm.runInNewContext(consumerCode, sandbox)
    requireModule('@dshx/consumer')
    expect('probe' in sandbox ? sandbox.probe : undefined).toEqual(['default-from-@dshx/shared-runtime', 'named-from-@dshx/shared-runtime'])
    expect(styles.map(style => [style.dataset.plugin, style.textContent.includes('#123456')])).toEqual([
      ['@dshx/shared-runtime', false],
      ['dshx:shared-css', true],
      ['@dshx/consumer', false],
    ])
    // The supplier owns the sheet, so the consumer must ship neither the marker hash nor any sheet-derived literal:
    // a class change anywhere must leave this bundle byte-identical.
    expect(styles[2]?.dataset.dshxCss).toBeUndefined()
    expect(consumerCode).not.toContain(manifest.cssHash)
  })

  it('keeps its own sheet when the supplier sheet differs', async () => {
    const supplierRoot = await mkdtemp(resolve(tmpdir(), 'dshx-shared-'))
    temporaryDirectories.push(supplierRoot)
    await mkdir(resolve(supplierRoot, 'src'), { recursive: true })
    await mkdir(resolve(supplierRoot, 'node_modules/shared-lib'), { recursive: true })
    await writeFile(
      resolve(supplierRoot, 'package.json'),
      JSON.stringify({ name: '@dshx/shared-runtime', version: '0.0.0', type: 'module', dsh: { client: { platform: 'web', inject: [], external: [] } } }),
    )
    await writeFile(
      resolve(supplierRoot, 'node_modules/shared-lib/package.json'),
      JSON.stringify({ name: 'shared-lib', type: 'module', exports: './index.js' }),
    )
    await writeFile(resolve(supplierRoot, 'node_modules/shared-lib/index.js'), 'export const named = 1\n')
    await writeFile(
      resolve(supplierRoot, 'src/client.ts'),
      "import { defineClient } from '@dshfiles/dshx/client'\nexport default defineClient({ setup() {} })\n",
    )
    await buildClient({ packageId: '@dshx/shared-runtime', root: supplierRoot, entry: 'src/client.ts', outDir: 'dist', sharedRuntime: ['shared-lib'] })

    const consumerRoot = await mkdtemp(resolve(tmpdir(), 'dshx-shared-'))
    temporaryDirectories.push(consumerRoot)
    await mkdir(resolve(consumerRoot, 'src'), { recursive: true })
    await mkdir(resolve(consumerRoot, 'node_modules/@dshx'), { recursive: true })
    await symlink(supplierRoot, resolve(consumerRoot, 'node_modules/@dshx/shared-runtime'), 'dir')
    await writeFile(
      resolve(consumerRoot, 'package.json'),
      JSON.stringify({
        name: '@dshx/consumer',
        version: '0.0.0',
        type: 'module',
        dsh: { client: { platform: 'web', inject: [], external: ['@dshx/shared-runtime'] } },
      }),
    )
    await writeFile(resolve(consumerRoot, 'src/client.css'), '.own-sheet { color: #654321 }\n')
    await writeFile(
      resolve(consumerRoot, 'src/client.ts'),
      "import { defineClient } from '@dshfiles/dshx/client'\nimport './client.css'\nexport default defineClient({ setup() {} })\n",
    )
    await buildClient({
      packageId: '@dshx/consumer',
      root: consumerRoot,
      entry: 'src/client.ts',
      outDir: 'dist',
      shared: '@dshx/shared-runtime',
      external: ['@dshx/shared-runtime'],
    })
    const code = await readFile(resolve(consumerRoot, 'dist/client.js'), 'utf8')
    expect(code).toContain('#654321')
    expect(code).toContain('require("@dshx/shared-runtime")')
  })

  it('does not remove the Host artifact from the shared output directory', async () => {
    const root = await temporaryProject()
    await mkdir(resolve(root, 'dist'), { recursive: true })
    await writeFile(resolve(root, 'dist/host.js'), 'export function apply() {}\n')
    await buildClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
    })
    expect(await readFile(resolve(root, 'dist/host.js'), 'utf8')).toBe('export function apply() {}\n')
  })

  it('rewrites the client artifact after a watched source change', async () => {
    const root = await temporaryProject()
    const result = await watchClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-connection'],
    })
    if (!('on' in result) || !('close' in result)) throw new Error('watch build did not return a watcher')
    const events: string[] = []
    result.on('event', event => {
      events.push(event.code)
    })

    const waitForArtifact = async (predicate: (code: string) => boolean): Promise<string> => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        try {
          const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
          if (predicate(code)) return code
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      }
      throw new Error(`timed out waiting for watched Client artifact; events: ${events.join(', ')}`)
    }

    try {
      const first = await waitForArtifact(code => code.includes('Build. Ship. Observe.'))
      // Artifact writes precede the native watcher's END/ready boundary.
      await vi.waitFor(() => expect(events).toContain('END'))
      const sourcePath = resolve(root, 'src/client.tsx')
      const source = await readFile(sourcePath, 'utf8')
      await writeFile(sourcePath, source.replace('Build. Ship. Observe.', 'Build. Ship. Observe. Rebuilt'))
      const second = await waitForArtifact(code => code.includes('Build. Ship. Observe. Rebuilt'))
      expect(first).not.toBe(second)
    } finally {
      await result.close()
    }
  })

  it('reruns setup-service diagnostics on every watched Client rebuild and recovers after a fix', async () => {
    const root = await temporaryProject()
    const sourcePath = resolve(root, 'src/client.tsx')
    const clientSource = (inject: boolean, marker: string) =>
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        `export default defineClient({ inject: [${inject ? "'slots', 'locale'" : "'slots'"}], setup(ctx) { ctx.locale.register('demo', { marker: '${marker}' }) } })`,
        '',
      ].join('\n')
    await writeFile(sourcePath, clientSource(true, 'initial-locale'))

    const result = await watchClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-locale'],
    })
    const events: Array<{ code: string; error?: unknown }> = []
    result.on('event', event => events.push(event))
    const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (await predicate()) return
        await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      }
      throw new Error(`timed out waiting for ${label}; events: ${events.map(event => event.code).join(', ')}`)
    }

    try {
      await waitFor(async () => (await readFile(resolve(root, 'dist/client.js'), 'utf8').catch(() => '')).includes('initial-locale'), 'initial Client build')
      await waitFor(() => events.some(event => event.code === 'END'), 'initial watch ready boundary')
      const beforeFailure = events.length
      await writeFile(sourcePath, clientSource(false, 'missing-locale'))
      await waitFor(() => events.slice(beforeFailure).some(event => event.code === 'ERROR'), 'incremental setup-service error')
      const failure = events.slice(beforeFailure).find(event => event.code === 'ERROR')
      expect(String(failure?.error)).toContain('DSHX1204')

      const beforeRecovery = events.length
      await writeFile(sourcePath, clientSource(true, 'fixed-locale'))
      await waitFor(() => events.slice(beforeRecovery).some(event => event.code === 'END'), 'incremental recovery')
      await waitFor(async () => (await readFile(resolve(root, 'dist/client.js'), 'utf8').catch(() => '')).includes('fixed-locale'), 'recovered Client artifact')
    } finally {
      await result.close()
    }
  })

  it('reruns declarative Locale provider diagnostics on watched rebuilds', async () => {
    const root = await temporaryProject()
    const sourcePath = resolve(root, 'src/client.tsx')
    const clientSource = (locales: boolean, marker: string) =>
      locales
        ? [
            "import { defineClient, defineLocale } from '@dshfiles/dshx/client'",
            `const copy = defineLocale('demo', { zh: { title: '${marker}' }, en: { title: '${marker}' } })`,
            'export default defineClient({ locales: [copy] })',
            '',
          ].join('\n')
        : ["import { defineClient } from '@dshfiles/dshx/client'", `export default defineClient({ name: '${marker}' })`, ''].join('\n')
    await writeFile(sourcePath, clientSource(false, 'initial-client'))

    const result = await watchClient({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
    })
    const events: Array<{ code: string; error?: unknown }> = []
    result.on('event', event => events.push(event))
    const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (await predicate()) return
        await new Promise(resolveTimer => setTimeout(resolveTimer, 20))
      }
      throw new Error(`timed out waiting for ${label}; events: ${events.map(event => event.code).join(', ')}`)
    }

    try {
      await waitFor(async () => (await readFile(resolve(root, 'dist/client.js'), 'utf8').catch(() => '')).includes('initial-client'), 'initial Client build')
      await waitFor(() => events.some(event => event.code === 'END'), 'initial watch ready boundary')
      const beforeFailure = events.length
      await writeFile(sourcePath, clientSource(true, 'missing-provider'))
      await waitFor(() => events.slice(beforeFailure).some(event => event.code === 'ERROR'), 'incremental Locale provider error')
      const failure = events.slice(beforeFailure).find(event => event.code === 'ERROR')
      expect(String(failure?.error)).toContain('DSHX1203')
      expect(String(failure?.error)).toContain('defineLocale')

      const beforeRecovery = events.length
      await writeFile(sourcePath, clientSource(false, 'recovered-client'))
      await waitFor(() => events.slice(beforeRecovery).some(event => event.code === 'END'), 'incremental Locale recovery')
      await waitFor(
        async () => (await readFile(resolve(root, 'dist/client.js'), 'utf8').catch(() => '')).includes('recovered-client'),
        'recovered Client artifact',
      )
    } finally {
      await result.close()
    }
  })
})
