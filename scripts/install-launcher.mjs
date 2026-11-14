#!/usr/bin/env node
/**
 * Install this checkout's `dsh` command on PATH, and drop launcher.json pins the checkout now supplies.
 *
 *   node scripts/install-launcher.mjs            show what would change; writes nothing
 *   node scripts/install-launcher.mjs --apply    write it, backing up each replaced file first
 *   --bin <path>                                 where `dsh` goes (default ~/.local/bin/dsh)
 *
 * The installed command is a two-line shim that runs scripts/dsh-launcher from this checkout, so the launcher,
 * its Node, its core and its checks always come from the checkout a `git pull` updates. A hand-written wrapper
 * that hardcodes a Node build or a core path drifts silently on the next update (2026-11: Node 22 and core
 * 0.2.1 under plugins built for 0.2.2).
 *
 * launcher.json keeps every machine-local choice (home, profile, port, verification marker, explicit cores).
 * Only pins the checkout now derives are removed: a `nodeBinary` or `path` naming an fnm Node build (the
 * launcher reads .node-version) and a `coreEntry` equal to the checkout's own core. It never stops or starts
 * DSH: the change applies to the next `dsh`.
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LauncherConfig } from './launcher-config.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FNM_BUILD = /\/node-versions\/v[^/]+\/installation\/bin(\/node)?$/

/** The shim text for a checkout. */
const shim = root => `#!/usr/bin/env bash\n# Installed by ${root}/scripts/install-launcher.mjs; rerun it to update.\nexec "${root}/scripts/dsh-launcher" "$@"\n`

/** launcher.json without the pins the checkout now derives, and why each went. */
const migratedConfig = (local, root) => {
  const next = { ...local }
  const removed = []
  if (typeof next.nodeBinary === 'string' && FNM_BUILD.test(next.nodeBinary)) {
    removed.push(`nodeBinary ${next.nodeBinary}: the launcher now runs the fnm build of the checkout's .node-version`)
    delete next.nodeBinary
  }
  if (typeof next.path === 'string' && next.path.split(delimiter).some(entry => FNM_BUILD.test(entry))) {
    removed.push(`path (it pins an fnm Node build): the launcher now puts the Host's Node first on the inherited PATH`)
    delete next.path
  }
  if (typeof next.coreEntry === 'string' && resolve(next.coreEntry) === join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')) {
    removed.push(`coreEntry ${next.coreEntry}: it is the checkout's own core, which the launcher now uses by default`)
    delete next.coreEntry
  }
  return { config: next, removed }
}

const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

const atomicWrite = (path, text, mode) => {
  const temporary = `${path}.install-${process.pid}`
  writeFileSync(temporary, text, { mode })
  renameSync(temporary, path)
  chmodSync(path, mode)
}

/** Plan, and with `apply` write, the shim and the launcher.json migration. Returns the report lines. */
const install = ({ root = ROOT, bin, env = process.env, apply = false }) => {
  const lines = []
  const target = bin ?? join(env.HOME || homedir(), '.local', 'bin', 'dsh')
  const wanted = shim(root)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  const configPath = LauncherConfig.configPath(env)
  const localText = existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined
  const migration = localText === undefined ? { config: undefined, removed: [] } : migratedConfig(JSON.parse(localText), root)
  // `dsh` must run the checkout the launcher prepares and builds, not whichever checkout ran this script.
  const sourceRoot = LauncherConfig.load(env).sourceRoot
  if (resolve(sourceRoot) !== resolve(root))
    throw new Error(
      `The launcher config selects source ${sourceRoot}, but this is ${root}. Run node ${sourceRoot}/scripts/install-launcher.mjs instead; nothing written`,
    )

  if (current === wanted) lines.push(`${target} already runs ${root}/scripts/dsh-launcher`)
  else
    lines.push(
      `${apply ? 'Installing' : 'Would install'} ${target} → ${root}/scripts/dsh-launcher${current === undefined ? '' : ' (the current file is backed up)'}`,
    )
  for (const reason of migration.removed) lines.push(`${apply ? 'Removing' : 'Would remove'} from ${configPath}: ${reason}`)
  if (!apply) {
    lines.push('Nothing written. Rerun with --apply; the running DSH is untouched and the change applies to the next `dsh`.')
    return lines
  }
  if (current !== wanted) {
    mkdirSync(dirname(target), { recursive: true })
    if (current !== undefined) {
      const backup = `${target}.before-install-${stamp()}`
      copyFileSync(target, backup)
      lines.push(`Backed up the previous ${target} to ${backup}`)
    }
    atomicWrite(target, wanted, 0o755)
  }
  if (migration.removed.length > 0) {
    const backup = `${configPath}.before-install-${stamp()}`
    copyFileSync(configPath, backup)
    atomicWrite(configPath, `${JSON.stringify(migration.config, null, 2)}\n`, 0o600)
    lines.push(`Backed up the previous launcher config to ${backup}`)
  }
  // Prove the result loads before saying it is done.
  const config = LauncherConfig.load(env)
  lines.push(`Next \`dsh\`: Node ${config.nodeBinary}, core ${LauncherConfig.requireCoreEntry(config)}, profile ${config.profile}.`)
  return lines
}

export class LauncherInstall {
  static install = install
  static shim = shim
  static migratedConfig = migratedConfig
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const binIndex = args.indexOf('--bin')
    const unknown = args.filter((arg, index) => arg !== '--apply' && arg !== '--bin' && index !== binIndex + 1)
    if (unknown.length > 0 || (binIndex !== -1 && args[binIndex + 1] === undefined)) throw new Error('Usage: install-launcher.mjs [--apply] [--bin <path>]')
    const bin = binIndex === -1 ? undefined : resolve(args[binIndex + 1])
    for (const line of install({ bin, apply: args.includes('--apply') })) console.log(line)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Launcher install failed')
    process.exitCode = 1
  }
}
