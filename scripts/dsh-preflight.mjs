#!/usr/bin/env node
/**
 * Check that the launcher's profile can start on the core that will run it.
 *
 *   node scripts/dsh-preflight.mjs           check only; writes nothing
 *   node scripts/dsh-preflight.mjs --apply   also applies recorded preset migrations (backup first)
 *                                            when no Host serves the profile
 *
 * The source supervisor runs it with --apply after building and relinking,
 * before every Host start. Any other launcher can run it the same way: a
 * non-zero exit means "do not start", and the output says why and what to do.
 * Configuration comes from the launcher config (docs/personal-configuration.md).
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Preflight } from './dsh-compat/preflight.mjs'
import { LauncherConfig } from './launcher-config.mjs'

const main = () => {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: dsh-preflight.mjs [--apply]')
  const config = LauncherConfig.load()
  const coreEntry = LauncherConfig.requireCoreEntry(config)
  const coreEntrySource =
    process.env.DSH_CORE_ENTRY !== undefined
      ? 'DSH_CORE_ENTRY (the environment overrides launcher.json)'
      : config.coreEntry === undefined
        ? 'the checkout default'
        : LauncherConfig.configPath()
  const result = Preflight.run({
    sourceRoot: config.sourceRoot,
    dshHome: config.dshHome,
    profile: config.profile,
    coreEntry,
    nodeBinary: config.nodeBinary,
    coreEntrySource,
    env: LauncherConfig.environment(config),
    apply: args.includes('--apply'),
  })
  const lines = Preflight.format(result, { profile: config.profile })
  ;(result.ok ? process.stdout : process.stderr).write(`${lines.join('\n')}\n`)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'DSH preflight failed')
    process.exitCode = 1
  }
}
