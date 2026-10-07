import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { buildClient, buildHost } from '../src/compiler/index.js'
import { createTestClient, createTestHost } from '../src/testing/index.js'
import { createClientModuleLoader } from '../src/testing/client-module.js'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'

describe('SDK source to native plugin', () => {
  it('builds ordinary TypeScript/React and unloads both native halves', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-sdk-build-'))
    const host = await createTestHost()
    const client = await createTestClient()
    try {
      await mkdir(resolve(root, 'src'))
      await writeFile(
        resolve(root, 'package.json'),
        JSON.stringify({ name: '@test/sdk-build', type: 'module', peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.1 <0.3.0-0' } }),
      )
      await writeFile(
        resolve(root, 'src/host.ts'),
        `
        import { definePlugin } from '@dshfiles/dshx/host'
        export default definePlugin({
          id: 'sdk-build', uses: ['commands'],
          setup(api) {
            api.commands.register({ name: 'hello', description: 'Say hello', handler: () => ({ kind: 'success', text: 'Hello' }) })
          },
        })
      `,
      )
      await writeFile(
        resolve(root, 'src/client.tsx'),
        `
        import { defineClientPlugin } from '@dshfiles/dshx/client'
        function Panel() { return <p>Hello</p> }
        export default defineClientPlugin({
          id: 'sdk-build', uses: ['ui'],
          setup(api) { api.ui.register({ name: 'main', key: 'example' }, Panel) },
        })
      `,
      )
      await buildHost({ root, packageId: '@test/sdk-build', entry: 'src/host.ts', outDir: 'dist' })
      await buildClient({ root, packageId: '@test/sdk-build', entry: 'src/client.tsx', outDir: 'dist', inject: ['@deepseek-ai/dsh-client-ui-renderer'] })
      const hostModule = await import(pathToFileURL(resolve(root, 'dist/index.js')).href)
      const mountedHost = await host.mount(hostModule, { native: true })
      expect(host.commands.get('hello')).toBeDefined()

      client.slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' } } }, (props: PropsRenderSlots<'main'>) => {
        void props.renderSlot
        return null
      })
      let factory: ((require: (id: string) => unknown) => Record<string, unknown>) | undefined
      const code = await readFile(resolve(root, 'dist/client.js'), 'utf8')
      expect(code).not.toContain('node:module')
      expect(code).not.toContain('react.production.min')
      runInNewContext(code, {
        window: {
          __ModuleLoader__: {
            load: (module: { factory: typeof factory }) => {
              factory = module.factory
            },
          },
        },
      })
      if (!factory) throw new Error('Missing native lazy Client factory')
      const clientModule = factory(createClientModuleLoader())
      const mountedClient = await client.mount(clientModule, { native: true })
      expect(client.slots.entries('main')).toHaveLength(1)
      await mountedClient.reload()
      expect(client.slots.entries('main')).toHaveLength(1)
      await mountedHost.dispose()
      await mountedClient.dispose()
      expect(host.commands.get('hello')).toBeUndefined()
      expect(client.slots.entries('main')).toHaveLength(0)
    } finally {
      await host.dispose()
      await client.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
