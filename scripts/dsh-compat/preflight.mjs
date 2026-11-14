/**
 * Startup preflight: prove the selected composition can start on the core that
 * will actually run it, before any Host starts.
 *
 * A successful build is not a successful startup. Three failures shipped past
 * one: a launcher still forcing an older core (`DSH_CORE_ENTRY`) under freshly
 * built plugins, so DSH skipped every incompatible bundle and services went
 * missing; selected plugins removed upstream whose stale `dist/` still linked;
 * and a saved agent preset naming a module the new core removed, so every new
 * thread failed with `agent-preset/invalid`. DSH reports the first two only as
 * stderr lines and still starts.
 *
 * Every check asks the configured core rather than re-implementing it:
 *
 * 1. core: which `@deepseek-ai/dsh` the entry belongs to, and whether it is the
 *    one this checkout's lockfile installed. An explicitly configured other
 *    core is kept (it is the user's choice) and validated like any other.
 * 2. node: the Node that runs the Host satisfies that core's `engines.node`.
 * 3. presets: saved agent presets reference modules that resolve and suit this
 *    core; recorded breaking changes are migrated, with a backup, only while no
 *    Host serves the profile.
 * 4. composition: `dsh --profile <p> --dump-config` composes the profile with
 *    the core's own loader. A non-zero exit, a skipped bundle or a disabled row
 *    fails the start.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runningHostPids } from '../running-hosts.mjs'
import { PresetMigration } from './presets.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const semver = createRequire(join(HERE, '..', '..', 'tooling', 'dshx', 'packages', 'dshx', 'package.json'))('semver')

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** The `@deepseek-ai/dsh` package that owns an entry file, or undefined. */
const corePackageOf = entry => {
  if (!existsSync(entry)) return undefined
  for (let directory = dirname(realpathSync(entry)); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = readJson(join(directory, 'package.json'))
    if (manifest?.name === '@deepseek-ai/dsh') return { directory, version: manifest.version, engines: manifest.engines ?? {} }
  }
  return undefined
}

/** The core this checkout's lockfile installed, where `pnpm install` puts it. */
const checkoutCoreEntry = sourceRoot => join(sourceRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** The error a failed core printed, without its stack: the lines before the first `at …` frame. */
const errorLines = (text, limit = 12) => {
  const lines = text.trim().split('\n')
  const frame = lines.findIndex(line => /^\s+at /.test(line))
  return (frame === -1 ? lines.slice(-limit) : lines.slice(Math.max(0, frame - limit), frame)).join('\n')
}

/**
 * @param {{ sourceRoot: string, dshHome: string, profile: string, coreEntry: string, nodeBinary: string,
 *           coreEntrySource?: string, env?: NodeJS.ProcessEnv, apply?: boolean,
 *           hostsRunning?: () => number[] }} options
 * @returns {{ ok: boolean, problems: { check: string, message: string }[], notes: string[], migrated: { file: string, backup: string | null }[] }}
 */
const run = options => {
  const { sourceRoot, dshHome, profile, coreEntry, nodeBinary, env = process.env, apply = false } = options
  const problems = []
  const notes = []
  let migrated = []
  const problem = (check, message) => problems.push({ check, message })
  const profileDir = join(dshHome, 'profiles', profile)
  const configured = options.coreEntrySource ?? 'the launcher configuration'

  // 1. core
  const core = corePackageOf(coreEntry)
  const checkoutEntry = checkoutCoreEntry(sourceRoot)
  const checkout = corePackageOf(checkoutEntry)
  if (core === undefined) {
    problem(
      'core',
      `coreEntry ${coreEntry} (from ${configured}) is not a file inside an @deepseek-ai/dsh package. Point it at ${checkoutEntry}, the core this checkout installs.`,
    )
    return { ok: false, problems, notes, migrated }
  }
  const external = checkout === undefined || core.directory !== checkout.directory
  const switchCore =
    checkout === undefined
      ? ''
      : ` To run the core this checkout was built for (dsh ${checkout.version}), set coreEntry to ${checkoutEntry} in ${configured}, or unset DSH_CORE_ENTRY if a wrapper exports an older one.`
  if (external) {
    notes.push(
      `this start runs dsh ${core.version} from ${coreEntry} (${configured}), not the core this checkout installs (${checkout === undefined ? `none at ${checkoutEntry}; run pnpm install` : `dsh ${checkout.version} at ${checkoutEntry}`})`,
    )
  }

  // 2. node
  const nodeVersion = spawnSync(nodeBinary, ['--version'], { encoding: 'utf8' }).stdout?.trim()
  const range = core.engines.node
  if (!nodeVersion) problem('node', `cannot run ${nodeBinary} --version; set nodeBinary to an official Node build`)
  else if (typeof range === 'string' && !semver.satisfies(nodeVersion, range, { includePrerelease: true })) {
    problem(
      'node',
      `dsh ${core.version} requires Node ${range}, but the Host would run on ${nodeVersion} (${nodeBinary}). ` +
        `Set nodeBinary in ${configured} to a matching official Node, for example fnm install ${readFileSync(join(sourceRoot, '.node-version'), 'utf8').trim()}, and use that build's bin/node.`,
    )
  }

  // 3. presets
  if (existsSync(join(profileDir, 'cordis.patch.yml'))) {
    try {
      const plan = PresetMigration.plan({ profileDir, coreRoot: core.directory, home: dshHome, node: nodeBinary })
      for (const error of plan.errors) problem('presets', error.message)
      for (const warning of plan.warnings) notes.push(warning.message)
      if (plan.changes.length > 0 && plan.errors.length === 0) {
        const running = apply ? (options.hostsRunning ?? (() => runningHostPids({ home: dshHome, profile, coreEntry, env })))() : []
        if (!apply || running.length > 0) {
          for (const change of plan.changes) {
            problem(
              'presets',
              `preset "${change.preset}" needs a recorded migration: ${change.change}.` +
                (running.length > 0
                  ? ` Stop the DSH Host (pid ${running.join(', ')}) and start again to apply it.`
                  : ' Start through the launcher to apply it.'),
            )
          }
        } else {
          migrated = PresetMigration.write(plan)
          for (const change of plan.changes) notes.push(`migrated preset "${change.preset}": ${change.change}`)
          for (const { file, backup } of migrated) notes.push(`rewrote ${file}; the previous version is ${backup}`)
        }
      }
    } catch (error) {
      problem('presets', `could not check saved agent presets: ${String(error.message ?? error)}`)
    }
  }

  // 4. composition, after any preset migration so it validates what will start
  const dump = spawnSync(nodeBinary, [coreEntry, '--profile', profile, '--dump-config'], {
    env: { ...env, DSH_HOME: dshHome },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const stderr = `${dump.stderr ?? ''}${dump.error === undefined ? '' : String(dump.error)}`
  if (dump.status !== 0) {
    problem(
      'composition',
      `dsh ${core.version} could not compose profile ${profile} (exit ${String(dump.status)}):\n${errorLines(stderr)}\nFix the file it names, or restore its backup from ${join(dshHome, 'backups')}.`,
    )
  }
  for (const line of stderr.split('\n')) {
    const skipped = /skipping profile bundle "([^"]+)": (.*)$/.exec(line)
    if (skipped !== null) {
      problem(
        'composition',
        `dsh ${core.version} would skip bundle ${skipped[1]}, so every service it provides would be missing: ${skipped[2].slice(0, 400)}.` +
          (external ? switchCore : ' Rebuild that plugin for this core, or remove it from the profile.'),
      )
    }
    const disabled = /disabling profile plugin (.*)$/.exec(line)
    if (disabled !== null) problem('composition', `dsh ${core.version} would disable ${disabled[1].slice(0, 400)}.${external ? switchCore : ''}`)
  }

  return { ok: problems.length === 0, problems, notes, migrated }
}

/** Human-readable report: problems first, each with its recovery. */
const format = (result, { profile }) => {
  const lines = []
  for (const note of result.notes) lines.push(`note: ${note}`)
  if (result.ok) lines.push(`preflight: profile ${profile} composes on this core; starting.`)
  else {
    lines.push(`preflight: profile ${profile} cannot start safely; nothing started.`)
    for (const { check, message } of result.problems) lines.push(`  [${check}] ${message}`)
  }
  return lines
}

/** Startup preflight for a source checkout launch. */
export class Preflight {
  static run = run
  static format = format
  static checkoutCoreEntry = checkoutCoreEntry
  static corePackageOf = corePackageOf
}
