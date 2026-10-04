import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pluginsRoot = resolve(repoRoot, '../plugins/@dshfiles')
const webProfileRoot = join(process.env.HOME ?? '', '.dsh/profiles/web')

/** Bundles every profile needs regardless of which plugin is under test. */
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

export interface PluginBoot {
  readonly pluginId: string
  readonly url: string
  readonly host: ChildProcessByStdio<null, Readable, Readable>
  output(): string
  close(): Promise<void>
}

export const findFreePort = async (): Promise<number> =>
  new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('could not reserve a port'))
        return
      }
      const { port } = address
      server.close(() => resolvePort(port))
    })
  })

/** Plugins that are packages, which is what the profile contract requires. */
export const listPlugins = async (): Promise<readonly string[]> => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const names = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  const plugins: string[] = []
  for (const name of names) {
    const manifest = await readFile(resolve(pluginsRoot, name, 'package.json'), 'utf8').catch(() => undefined)
    if (manifest === undefined) continue
    const parsed: unknown = JSON.parse(manifest)
    if (typeof parsed !== 'object' || parsed === null) continue
    // A directory with no dsh block is a library, not a plugin, and cannot boot.
    const dsh = (parsed as { dsh?: unknown }).dsh
    if (typeof dsh !== 'object' || dsh === null) continue
    plugins.push(`@dshfiles/${name}`)
  }
  return plugins.sort()
}

/**
 * Boot one plugin on its own.
 *
 * A plugin that only breaks alongside others hides behind them: the shipped
 * profile loads ten at once, so a broken one can be masked by whatever the others
 * happen to provide, and a plugin nobody has enabled is never exercised at all.
 * That is how five plugins sat in the repository with every check green and no
 * way to mount. Each gets its own disposable profile and its own Host here, so a
 * failure names the plugin that caused it.
 */
export const bootPluginAlone = async (pluginId: string, timeoutMs = 90_000): Promise<PluginBoot> => {
  const home = await mkdtemp(join(tmpdir(), 'dshx-plugin-boot-'))
  const profileName = 'isolated'
  const profileDir = join(home, 'profiles', profileName)
  await mkdir(profileDir, { recursive: true })

  const source = JSON.parse(await readFile(join(webProfileRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  const baseDeps = Object.fromEntries(
    Object.entries(source.dependencies ?? {}).filter(([name]) => !name.startsWith('@dshfiles/')),
  )
  const manifest = {
    ...source,
    dependencies: { ...baseDeps, [pluginId]: `link:${resolve(pluginsRoot, pluginId.replace('@dshfiles/', ''))}` },
    dsh: { ...source.dsh, profile: { bundles: [...BASE_BUNDLES, pluginId] } },
  }
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  // The profile patch belongs to the shipped composition; an isolated boot composes
  // its own, so inheriting it would re-add every other plugin's configuration.
  await cp(join(webProfileRoot, 'pnpm-workspace.yaml'), join(profileDir, 'pnpm-workspace.yaml')).catch(() => undefined)

  const port = await findFreePort()
  const host = spawn('dsh', ['--profile', profileName, '--port', String(port), '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessByStdio<null, Readable, Readable>

  let output = ''
  host.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  host.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })

  const url = await new Promise<string>((resolveUrl, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output)
      if (match?.[0] !== undefined) {
        clearInterval(timer)
        resolveUrl(match[0])
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        host.kill('SIGKILL')
        reject(new Error(`${pluginId} did not announce a URL within ${String(timeoutMs)}ms:\n${output}`))
      }
    }, 250)
    host.once('exit', (code: number | null) => {
      clearInterval(timer)
      reject(new Error(`${pluginId} exited with code ${String(code)} before announcing a URL:\n${output}`))
    })
  })

  return {
    pluginId,
    url,
    host,
    output: () => output,
    async close(): Promise<void> {
      host.kill('SIGTERM')
      await new Promise<void>(done => {
        const timer = setTimeout(() => {
          host.kill('SIGKILL')
          done()
        }, 3_000)
        host.once('exit', () => {
          clearTimeout(timer)
          done()
        })
      })
      await rm(home, { recursive: true, force: true })
    },
  }
}