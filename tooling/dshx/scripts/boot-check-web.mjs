#!/usr/bin/env node

/** Boot each owned plugin alone in a composed scratch profile and a real browser. */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const listPlugins = async () => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const plugins = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = await readFile(resolve(pluginsRoot, entry.name, 'package.json'), 'utf8').catch(() => undefined)
    if (manifest === undefined) continue
    const { dsh } = JSON.parse(manifest)
    if (typeof dsh !== 'object' || dsh === null) continue
    plugins.push({
      id: `@dshfiles/${entry.name}`,
      dir: resolve(pluginsRoot, entry.name),
      hasClient: typeof dsh.client === 'object' && dsh.client !== null,
    })
  }
  return plugins.sort((left, right) => left.id.localeCompare(right.id))
}

const bootAlone = async plugin => {
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
  if (result.processError !== undefined) return result.processError.split('\n')[0]
  if (result.browserError !== undefined) return result.browserError.split('\n')[0]
  if (result.compositionFailures.length > 0) {
    return `was never composed: offline dump-config is missing ${result.compositionFailures.join(', ')}`
  }
  if (result.missingClientEntries.length > 0) {
    return `boot manifest is missing expected Client entries ${result.missingClientEntries.join(', ')}`
  }
  if (result.slotFailures.length > 0) {
    return `mounted an error boundary for ${result.slotFailures.map(entry => entry.slot).join(', ')}`
  }
  if (result.failures.length > 0) return result.failures.map(entry => `${entry.id} (${entry.state})`).join(', ')
  if (!result.ok) return 'the Web UI did not mount cleanly'
  return undefined
}

const main = async () => {
  await pinnedNode()
  const plugins = await listPlugins()
  if (plugins.length === 0) throw new Error('No DSH bundles found to boot.')
  const failures = []
  for (const plugin of plugins) {
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
    console.log(`\nAll ${String(plugins.length)} plugins booted on their own.`)
    return
  }
  console.error(`\n${String(failures.length)} of ${String(plugins.length)} plugins did not boot cleanly:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
}

await main()
