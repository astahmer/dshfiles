import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, describe, expect, test } from 'vitest'
import multiHostHost from '../src/host.js'
import { RuntimeLaunchFile } from '../src/launch-file.js'

// How the mounted Host publishes and withdraws its launch file, pinned before it becomes a scoped `LaunchFile` layer.

const originalHome = process.env.DSH_HOME
const homes: string[] = []

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const mountWithWebServer = async () => {
  const home = await mkdtemp(join(tmpdir(), 'multi-host-launch-host-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const host = await createTestHost()
  const connection = host.ctx.get('connection')
  if (connection === undefined) throw new Error('The test Host provides a connection.')
  host.connection.dispose()
  host.ctx.provide('connection', { ...connection, authenticatedUrl: (url: string) => `${url}/?token=launch-host-token-123456` })
  host.ctx.provide('webServer', { port: 43_210, host: '127.0.0.1', protocol: 'http:' })
  const mounted = await host.mount(multiHostHost, { packageId: '@dshfiles/multi-host', config: {} })
  const [launchPath] = RuntimeLaunchFile.launchFilePaths(home)
  return { host, mounted, launchPath }
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe('Host launch file lifecycle', () => {
  test('publishes a private launch record for the authenticated web URL once connection and webServer exist', async () => {
    const { host, launchPath } = await mountWithWebServer()
    try {
      await expect.poll(() => exists(launchPath)).toBe(true)
      expect((await stat(launchPath)).mode & 0o777).toBe(0o600)
      expect((await stat(dirname(launchPath))).mode & 0o777).toBe(0o700)
      const record = JSON.parse(await readFile(launchPath, 'utf8'))
      expect(record).toMatchObject({ schemaVersion: 1, launchUrl: 'http://127.0.0.1:43210/?token=launch-host-token-123456', pid: process.pid })
    } finally {
      await host.dispose()
    }
  })

  test('removes its own record when the plugin is disposed', async () => {
    const { host, mounted, launchPath } = await mountWithWebServer()
    try {
      await expect.poll(() => exists(launchPath)).toBe(true)
      await mounted.dispose()
      await expect.poll(() => exists(launchPath)).toBe(false)
    } finally {
      await host.dispose()
    }
  })

  test('leaves a record another process wrote in the meantime when disposed', async () => {
    const { host, mounted, launchPath } = await mountWithWebServer()
    try {
      await expect.poll(() => exists(launchPath)).toBe(true)
      await writeFile(launchPath, JSON.stringify({ schemaVersion: 1, launchUrl: 'http://127.0.0.1:1/?token=other-runtime-1', pid: process.pid + 1 }))
      await mounted.dispose()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(await readFile(launchPath, 'utf8')).toContain('other-runtime-1')
    } finally {
      await host.dispose()
    }
  })
})
