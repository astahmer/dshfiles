#!/usr/bin/env node

/** Boot each owned plugin alone in a composed scratch profile and a real browser. */

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPluginBundles, pluginsToBoot, readBootIgnores, validateBootIgnores } from './plugin-inventory.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pluginsRoot = resolve(workspace, 'plugins/@dshfiles')
const dshxDist = resolve(workspace, 'tooling/dshx/packages/dshx/dist')
const { prepareBootProfile } = await import(resolve(dshxDist, 'project/boot-profile.js'))
const { checkClientBoot } = await import(resolve(dshxDist, 'project/client-boot-check.js'))

const pinnedNode = async () => {
  const pinned = (await readFile(resolve(workspace, '.node-version'), 'utf8')).trim()
  if (pinned !== '' && pinned !== process.versions.node) {
    throw new Error(`The gate requires repository Node ${pinned}; current Node is ${process.versions.node}.`)
  }
}

/** Build the local artifacts before installing their linked bundles in the scratch profile. */
const buildPlugin = plugin =>
  new Promise((resolveBuild, rejectBuild) => {
    const child = spawn('pnpm', ['exec', 'dshx', 'build'], { cwd: plugin.dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const collect = chunk => {
      output = `${output}${String(chunk)}`.slice(-8_192)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const finish = callback => value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', handleError)
      child.off('close', handleClose)
      callback(value)
    }
    const fail = finish(rejectBuild)
    const complete = finish(resolveBuild)
    const handleError = error => fail(new Error(`${plugin.id} build could not be spawned: ${error.message}`))
    const handleClose = code => {
      if (code === 0) complete()
      else fail(new Error(`${plugin.id} build exited with ${String(code)}:\n${output}`))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`${plugin.id} build exceeded 180000ms:\n${output}`))
    }, 180_000)
    child.once('error', handleError)
    child.once('close', handleClose)
  })

const bootAlone = async plugin => {
  await buildPlugin(plugin)
  const profile = await prepareBootProfile(plugin.dir, plugin.id)
  try {
    return await checkClientBoot({
      projectRoot: workspace,
      profile: profile.profile,
      port: 0,
      dshHome: profile.homeRoot,
      profileRoot: profile.profileRoot,
      expectedBundles: profile.expectedBundles,
      expectedClientEntries: plugin.hasClient ? [plugin.id] : [],
    })
  } finally {
    await profile.dispose()
  }
}

const describe = result => {
  if (result.spawnError !== undefined) return result.spawnError.split('\n')[0]
  if (result.processError !== undefined) return result.processError.split('\n')[0]
  if (result.browserError !== undefined) return result.browserError.split('\n').filter(Boolean).slice(-6).join(' | ')
  if (result.compositionFailures.length > 0) {
    return `was never composed: offline dump-config is missing ${result.compositionFailures.join(', ')}`
  }
  if (result.missingClientEntries.length > 0) {
    return `boot manifest is missing expected Client entries ${result.missingClientEntries.join(', ')}`
  }
  if (result.evidence === 'blank') return 'booted a blank page: the kernel-owned boot element never appeared, so nothing was verified'
  if (result.evidence === 'stalled') return 'left the boot element up for the whole window without reporting a failure'
  if (result.slotFailures.length > 0) {
    return `mounted an error boundary for ${result.slotFailures.map(entry => entry.slot).join(', ')}, so those panels are blank even though every entry activated`
  }
  if (result.failures.length > 0) return result.failures.map(entry => `${entry.id} (${entry.state})`).join(', ')
  if (!result.ok) return 'the Web UI did not mount cleanly'
  return undefined
}

const main = async () => {
  await pinnedNode()
  const plugins = await listPluginBundles(pluginsRoot)
  if (plugins.length === 0) throw new Error('No DSH bundles found to boot.')
  const ignores = await readBootIgnores(resolve(workspace, 'tooling/dshx/scripts/boot-ignore.json'))
  const ignoredIds = validateBootIgnores(ignores, plugins)
  const runnable = pluginsToBoot(plugins, ignoredIds)
  for (const ignore of ignores) {
    console.log(`  skip ${ignore.packageId}: ${ignore.reason} (owner: ${ignore.owner}; remove when: ${ignore.removalCondition}${ignore.expiresOn === undefined ? '' : `; expires: ${ignore.expiresOn}`})`)
  }
  if (runnable.length === 0) throw new Error('Every DSH bundle is ignored; boot gate must test at least one plugin.')
  const failures = []
  for (const plugin of runnable) {
    const result = await bootAlone(plugin).catch(error => ({
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
  if (failures.length === 0) {
    console.log(`\nAll ${String(runnable.length)} of ${String(plugins.length)} discovered plugins booted on their own${ignoredIds.size === 0 ? '' : `; ${String(ignoredIds.size)} ignored with documented removal conditions`}.`)
    return
  }
  console.error(`\n${String(failures.length)} of ${String(runnable.length)} tested plugins did not boot cleanly (${String(plugins.length)} discovered, ${String(ignoredIds.size)} ignored):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
}

await main()
