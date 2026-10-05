#!/usr/bin/env node

/**
 * Boot every installed plugin on its own and fail on anything that does not mount.
 *
 * Typecheck, the compiler's provider checks, and the Host boot check all pass on a
 * client plugin whose panel never renders, because the failure happens in a browser
 * after every static gate has already agreed. Plugins once sat in this repository
 * green across every check and invisible to anyone, because nobody had enabled them
 * and nothing booted a profile.
 *
 * Booting them together would not help either: a plugin can be masked by whatever the
 * other nine happen to provide, and the failure then names a dependant rather than the
 * cause. So each one gets a disposable profile and its own Host, and a Slot that falls
 * back to its error boundary fails just as an entry that never reaches active does.
 */

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pluginsRoot = resolve(workspace, 'plugins/@dshfiles')
const webProfile = join(process.env.HOME ?? '', '.dsh/profiles/web')
const profileName = 'isolated'
const baseBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const { checkClientBoot } = await import(resolve(workspace, 'tooling/dshx/packages/dshx/dist/project/client-boot-check.js'))

/**
 * DSH's native loader fails on a Node build it does not pin, and every plugin
 * then fails uniformly, which reads like a plugin defect. Refuse to run on a
 * Node other than the one the repository pins, naming both versions.
 */
const pinnedNode = async () => {
  const pinned = (await readFile(join(workspace, '.node-version'), 'utf8')).trim()
  if (pinned !== '' && pinned !== process.versions.node) {
    throw new Error(
      `This gate boots real DSH hosts, which only run on the repository's pinned Node ${pinned}; this process is Node ${process.versions.node}. Rerun with: fnm exec --using ${pinned} node scripts/boot-check-web.mjs`,
    )
  }
}

/** The package manager installs the profile's link: dependencies. */
const pnpmInstall = profileDir =>
  new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install', '--prefer-offline'], { cwd: profileDir, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`pnpm install in ${profileDir} timed out: ${stderr.slice(-400)}`))
    }, 180_000)
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`pnpm install exited ${String(code)}: ${stderr.slice(-400)}`))
    })
  })

/** Directories that are packages: a `dsh` block is what makes one a plugin. */
const listPlugins = async () => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const plugins = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = await readFile(resolve(pluginsRoot, entry.name, 'package.json'), 'utf8').catch(() => undefined)
    if (manifest === undefined) continue
    const { dsh } = JSON.parse(manifest)
    // A library has no dsh block, so it has no bundle and cannot be booted.
    if (typeof dsh !== 'object' || dsh === null) continue
    plugins.push({ id: `@dshfiles/${entry.name}`, dir: resolve(pluginsRoot, entry.name) })
  }
  return plugins.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * One plugin alone: its own DSH_HOME, a profile provisioned with the link: route
 * the repository verified, and DSHX_BOOT_PROFILE_ROOT pointed at that profile —
 * the variable DSH resolves profiles from, so the plugin is really composed and
 * booted rather than silently absent from an empty default profile.
 */
const bootAlone = async (plugin, sourceProfile) => {
  const home = await mkdtemp(join(tmpdir(), 'dshx-boot-'))
  const profileDir = join(home, 'profiles', profileName)
  await mkdir(profileDir, { recursive: true })
  const inherited = Object.fromEntries(Object.entries(sourceProfile.dependencies ?? {}).filter(([name]) => !name.startsWith('@dshfiles/')))
  await writeFile(
    join(profileDir, 'package.json'),
    `${JSON.stringify(
      {
        ...sourceProfile,
        dependencies: { ...inherited, [plugin.id]: `link:${plugin.dir}` },
        dsh: { ...sourceProfile.dsh, profile: { bundles: [...baseBundles, plugin.id] } },
      },
      null,
      2,
    )}\n`,
  )
  await cp(join(webProfile, 'pnpm-workspace.yaml'), join(profileDir, 'pnpm-workspace.yaml')).catch(() => undefined)
  await pnpmInstall(profileDir)

  // checkClientBoot owns the Host and the browser; the prepared profile root and
  // the expected bundle id make a vacuous boot impossible.
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await checkClientBoot({
      projectRoot: workspace,
      profile: profileName,
      port: 0,
      profileRoot: profileDir,
      expectedBundles: [plugin.id],
    })
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
}

const describe = result => {
  if (result.browserError !== undefined) return result.browserError.split('\n')[0]
  if (result.compositionFailures.length > 0) {
    return `was never composed: the offline dump-config is missing ${result.compositionFailures.join(', ')}`
  }
  if (result.slotFailures.length > 0) {
    return `mounted an error boundary for ${result.slotFailures.map(entry => entry.slot).join(', ')}, so those panels are blank even though every entry activated`
  }
  if (result.failures.length > 0) return result.failures.map(entry => `${entry.id} (${entry.state})`).join(', ')
  if (!result.ok) return 'the Web UI did not mount cleanly'
  return undefined
}

const main = async () => {
  await pinnedNode()
  const plugins = await listPlugins()
  if (plugins.length === 0) throw new Error('no plugins found to boot')
  const sourceProfile = JSON.parse(await readFile(join(webProfile, 'package.json'), 'utf8'))
  const failures = []

  for (const plugin of plugins) {
    const result = await bootAlone(plugin, sourceProfile).catch(error => ({
      ok: false,
      failures: [],
      slotFailures: [],
      compositionFailures: [],
      browserError: error instanceof Error ? error.message : String(error),
    }))
    const problem = describe(result)
    if (problem === undefined) console.log(`  ok  ${plugin.id}`)
    else failures.push(`${plugin.id}: ${problem}`)
  }

  if (failures.length > 0) {
    console.error(`\n${String(failures.length)} of ${String(plugins.length)} plugins did not boot cleanly:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`\nAll ${String(plugins.length)} plugins booted on their own.`)
}

await main()
