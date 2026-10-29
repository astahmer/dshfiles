#!/usr/bin/env node

/**
 * Boot each owned plugin alone in a composed scratch profile and a real browser, then the full web profile.
 *
 * Root `pnpm check:plugin-boot` builds once and runs the cached Turbo tasks instead: `--plugin` boots the bundle in
 * the current directory alone, `--composed` boots the shared-runtime pair and the full profile, and
 * `--validate-ignores` checks boot-ignore.json, whose expiry dates no cache key can see. Registry dependencies come
 * from the checked-in `profiles/web` seed, not the live profile, so a cached pass depends only on the repository.
 */

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPluginBundles, pluginsToBoot, readBootIgnores, validateBootIgnores } from './plugin-inventory.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pluginsRoot = resolve(workspace, 'plugins/@dshfiles')
const dshxDist = resolve(workspace, 'tooling/dshx/packages/dshx/dist')
const { prepareComposedBootProfile } = await import(resolve(dshxDist, 'project/boot-profile.js'))
const { checkClientBoot } = await import(resolve(dshxDist, 'project/client-boot-check.js'))
const sourceProfileRoot = resolve(workspace, 'profiles/web')

const pinnedNode = async () => {
  const pinned = (await readFile(resolve(workspace, '.node-version'), 'utf8')).trim()
  if (pinned !== '' && pinned !== process.versions.node) {
    throw new Error(`The gate requires repository Node ${pinned}; current Node is ${process.versions.node}.`)
  }
}

/** Build the local artifacts before installing their linked bundles in the scratch profile. */
const buildPlugin = plugin =>
  new Promise((resolveBuild, rejectBuild) => {
    const child = spawn('pnpm', ['exec', 'node', 'scripts/turbo.mjs', 'run', 'build', `--filter=${plugin.id}`], {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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
  const profile = await prepareComposedBootProfile([{ projectRoot: plugin.dir, packageId: plugin.id }], { sourceProfileRoot })
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

const bootComposed = async (plugins, ignoredIds, includeSourceProfileBundles = true) => {
  const profile = await prepareComposedBootProfile(
    plugins.map(plugin => ({ projectRoot: plugin.dir, packageId: plugin.id })),
    includeSourceProfileBundles ? { sourceProfileRoot, includeSourceProfileBundles: true } : {},
  )
  try {
    return await checkClientBoot({
      projectRoot: workspace,
      profile: profile.profile,
      port: 0,
      dshHome: profile.homeRoot,
      profileRoot: profile.profileRoot,
      expectedBundles: profile.expectedBundles,
      expectedClientEntries: plugins.filter(plugin => plugin.hasClient && !ignoredIds.has(plugin.id)).map(plugin => plugin.id),
    })
  } finally {
    await profile.dispose()
  }
}

const describe = (result, ignoredIds = new Set()) => {
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
    return `lost ${result.slotFailures.map(entry => entry.slot).join(', ')} to a render crash, so ${
      result.slotFailures.length === 1 ? 'that panel shows a fallback entry' : 'those panels show fallback entries'
    } even though every entry activated`
  }
  const failures = result.failures.filter(entry => !ignoredIds.has(entry.id))
  if (failures.length > 0) return failures.map(entry => `${entry.id} (${entry.state})`).join(', ')
  if (result.readinessError !== undefined) return result.readinessError.split('\n')[0]
  if (result.timedOut) return 'the Web UI did not become ready before the timeout'
  if (!result.browserReady) return 'the Web UI did not become ready'
  const onlyIgnoredFailures = result.failures.length > 0 && failures.length === 0
  if (!result.ok && !onlyIgnoredFailures) return 'the Web UI did not mount cleanly'
  return undefined
}

const errorSummary = error => (error instanceof Error ? error.message : String(error)).split('\n').filter(Boolean).slice(0, 5).join(' | ')

const bootOnePlugin = async (plugins, ignoredIds) => {
  const { name } = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'))
  const plugin = plugins.find(candidate => candidate.id === name)
  if (plugin === undefined) throw new Error(`${name} is not a DSH bundle under plugins/@dshfiles.`)
  if (ignoredIds.has(plugin.id)) {
    console.log(`  skip ${plugin.id}: listed in boot-ignore.json`)
    return
  }
  const result = await bootAlone(plugin).catch(error => ({ browserError: error instanceof Error ? error.message : String(error) }))
  const problem = describe(result)
  if (problem === undefined) {
    console.log(`  ok  ${plugin.id}`)
    return
  }
  console.error(`  - ${plugin.id}: ${problem}`)
  process.exitCode = 1
}

const main = async () => {
  await pinnedNode()
  const plugins = await listPluginBundles(pluginsRoot)
  if (plugins.length === 0) throw new Error('No DSH bundles found to boot.')
  const ignores = await readBootIgnores(resolve(workspace, 'tooling/dshx/scripts/boot-ignore.json'))
  const ignoredIds = validateBootIgnores(ignores, plugins)
  if (process.argv.includes('--validate-ignores')) {
    console.log(`boot-ignore.json: ${String(ignores.length)} documented, unexpired entries.`)
    return
  }
  if (process.argv.includes('--plugin')) {
    await bootOnePlugin(plugins, ignoredIds)
    return
  }
  const composedOnly = process.argv.includes('--composed')
  const runnable = pluginsToBoot(plugins, ignoredIds)
  const profileManifest = JSON.parse(await readFile(resolve(sourceProfileRoot, 'package.json'), 'utf8'))
  const profilePluginIds = profileManifest.dsh.profile.bundles.filter(packageId => packageId.startsWith('@dshfiles/'))
  const pluginById = new Map(plugins.map(plugin => [plugin.id, plugin]))
  const providerPairIds = ['@dshfiles/shared-runtime', '@dshfiles/settings-shell']
  const providerPair = providerPairIds.map(packageId => {
    const plugin = pluginById.get(packageId)
    if (plugin === undefined) throw new Error(`Web profile provider smoke is missing ${packageId}.`)
    return plugin
  })
  const profilePlugins = profilePluginIds.map(packageId => {
    const plugin = pluginById.get(packageId)
    if (plugin === undefined) throw new Error(`Web profile bundle ${packageId} has no source plugin directory.`)
    return plugin
  })
  for (const ignore of ignores) {
    console.log(
      `  skip ${ignore.packageId}: ${ignore.reason} (owner: ${ignore.owner}; remove when: ${ignore.removalCondition}${ignore.expiresOn === undefined ? '' : `; expires: ${ignore.expiresOn}`})`,
    )
  }
  if (runnable.length === 0) throw new Error('Every DSH bundle is ignored; boot gate must test at least one plugin.')
  const failures = []
  const buildFailures = new Set()
  const builtPluginIds = new Set()
  for (const plugin of composedOnly ? [] : providerPair) {
    try {
      await buildPlugin(plugin)
      builtPluginIds.add(plugin.id)
    } catch (error) {
      buildFailures.add(plugin.id)
      failures.push(`${plugin.id}: build failed: ${errorSummary(error)}`)
    }
  }
  if (buildFailures.size === 0) {
    const result = await bootComposed(providerPair, new Set(), false).catch(error => ({
      ok: false,
      failures: [],
      slotFailures: [],
      compositionFailures: [],
      browserError: error instanceof Error ? error.message : String(error),
    }))
    const problem = describe(result)
    if (problem === undefined) console.log('  ok  shared-runtime consumer composition')
    else failures.push(`shared-runtime consumer composition: ${problem}`)
  } else {
    failures.push('shared-runtime consumer composition: skipped because its provider or consumer failed to build')
  }
  if (process.argv.includes('--provider-pair')) {
    if (failures.length > 0) {
      console.error('\nShared-runtime consumer smoke failed:')
      for (const failure of failures) console.error(`  - ${failure}`)
      process.exitCode = 1
      return
    }
    console.log('\nShared-runtime consumer smoke passed.')
    return
  }
  for (const plugin of composedOnly ? [] : plugins) {
    if (builtPluginIds.has(plugin.id)) continue
    try {
      await buildPlugin(plugin)
      builtPluginIds.add(plugin.id)
    } catch (error) {
      buildFailures.add(plugin.id)
      failures.push(`${plugin.id}: build failed: ${errorSummary(error)}`)
    }
  }

  for (const plugin of composedOnly ? [] : runnable) {
    if (buildFailures.has(plugin.id)) continue
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
  if (buildFailures.size === 0) {
    const result = await bootComposed(profilePlugins, ignoredIds).catch(error => ({
      ok: false,
      failures: [],
      slotFailures: [],
      compositionFailures: [],
      browserError: error instanceof Error ? error.message : String(error),
    }))
    const problem = describe(result, ignoredIds)
    if (problem === undefined) console.log(`  ok  full web profile (${String(profilePlugins.length)} local bundles)`)
    else failures.push(`full web profile: ${problem}`)
  } else {
    failures.push('full web profile: composition smoke skipped because one or more bundles failed to build')
  }
  if (failures.length === 0 && composedOnly) {
    console.log('\nShared-runtime consumer composition and full web profile composition booted clean.')
    return
  }
  if (failures.length === 0) {
    console.log(
      `\nAll ${String(runnable.length)} of ${String(plugins.length)} discovered plugins booted alone; full web profile composition booted clean${ignoredIds.size === 0 ? '' : `; ${String(ignoredIds.size)} ignored with documented removal conditions`}.`,
    )
    return
  }
  console.error(
    `\n${String(failures.length)} of ${String(runnable.length)} tested plugins did not boot cleanly (${String(plugins.length)} discovered, ${String(ignoredIds.size)} ignored):`,
  )
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
}

await main()
