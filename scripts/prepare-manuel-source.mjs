import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkStartupPatch } from './network-startup-patch.mjs'
import { LauncherConfig } from './launcher-config.mjs'

// Relink only an existing profile's selected packages. Never seed accounts or
// apply the upstream web profile's personal defaults/new plugin selection.
export function sourceLinkedManifest(original, root, { enableHmrGate = false } = {}) {
  const result = structuredClone(original)
  if (!result.dependencies || !Array.isArray(result.dsh?.profile?.bundles)) throw new Error('Invalid existing profile manifest')
  if (enableHmrGate) {
    const name = '@dshfiles/hmr-gate'
    result.dependencies[name] = `link:${join(root, 'plugins', name)}`
    if (!result.dsh.profile.bundles.includes(name)) {
      const afterWeb = result.dsh.profile.bundles.indexOf('@deepseek-ai/dsh-web-app') + 1
      result.dsh.profile.bundles.splice(afterWeb, 0, name)
    }
  }
  for (const name of result.dsh.profile.bundles) {
    if (!name.startsWith('@dshfiles/')) continue
    if (!/^@dshfiles\/[a-z0-9][a-z0-9-]*$/.test(name) || !(name in result.dependencies)) throw new Error('Selected package is invalid or lacks a dependency')
    result.dependencies[name] = `link:${join(root, 'plugins', name)}`
  }
  return result
}

function atomicWrite(path, text) {
  const temporary = `${path}.source-launch-${process.pid}`
  writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
}

function main() {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) throw new Error('Usage: prepare-manuel-source.mjs [--check]')
  const checkOnly = process.argv[2] === '--check'
  const config = LauncherConfig.load()
  const root = config.sourceRoot
  const home = config.dshHome
  const profile = join(home, 'profiles', config.profile)
  const path = join(profile, 'package.json')
  const originalText = readFileSync(path, 'utf8')
  const original = JSON.parse(originalText)
  const desired = sourceLinkedManifest(original, root)
  const selected = desired.dsh.profile.bundles.filter(name => name.startsWith('@dshfiles/'))
  for (const name of selected) {
    if (!existsSync(join(root, 'plugins', name, 'dist/index.js'))) throw new Error(`Build the selected package before launch: ${name}`)
  }
  const changed = JSON.stringify(original) !== JSON.stringify(desired)
  const patch = join(profile, 'cordis.patch.yml')
  const originalPatch = existsSync(patch) ? readFileSync(patch, 'utf8') : '[]\n'
  const networkSelected = selected.includes('@dshfiles/loopback-access')
  if (networkSelected) {
    for (const entry of ['startup', 'terminal-output']) {
      if (!existsSync(join(root, `plugins/@dshfiles/loopback-access/dist/${entry}.js`)))
        throw new Error(`Build the Network access ${entry} entry before launch`)
    }
  }
  // Only an explicit machine-local migration choice supplies a legacy port.
  const desiredPatch = networkSelected ? networkStartupPatch(originalPatch, { legacyPort: config.legacyPort }) : originalPatch
  const patchChanged = desiredPatch !== originalPatch
  if (checkOnly) {
    console.log(
      `${selected.length} selected source bundles built; profile ${changed ? 'will relink on next start' : 'already links to source'}; network wiring ${patchChanged ? 'will update after DSH is stopped' : 'is current'}. No files changed.`,
    )
    return
  }
  const running = spawnSync('pgrep', ['-u', String(process.getuid()), '-f', LauncherConfig.runningProfilePattern(config)], { stdio: 'ignore' })
  if (running.status === 0) throw new Error('Stop the existing DSH before relinking its profile')
  if (running.error || running.status !== 1) throw new Error('Could not establish that DSH is stopped; refusing profile writes')
  if (!changed && !patchChanged) return
  const parent = join(home, 'backups/source-link')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const backup = mkdtempSync(join(parent, 'before-source-link-'))
  writeFileSync(join(backup, 'package.json'), originalText, { mode: 0o600 })
  if (existsSync(patch)) copyFileSync(patch, join(backup, 'cordis.patch.yml'))
  // The upstream usage fold changes on first activation. Snapshot the derived
  // database at quiescence, without copying or rewriting credentials/accounts.
  if (changed)
    execFileSync(
      'python3',
      [
        '-c',
        `
import os,pathlib,shutil,sqlite3,sys
from urllib.parse import quote
source=pathlib.Path(sys.argv[1]); destination=pathlib.Path(sys.argv[2])/'usage.db'
needed=(source.stat().st_size*2 if source.exists() else 0)+128*1024*1024
if shutil.disk_usage(sys.argv[2]).free < needed: raise SystemExit('Insufficient disk space for backup/reindex')
if source.exists():
    with sqlite3.connect('file:'+quote(str(source))+'?mode=ro',uri=True) as old, sqlite3.connect(destination) as new:
        old.backup(new)
        if new.execute('PRAGMA quick_check').fetchone()[0]!='ok': raise SystemExit('Usage backup failed integrity check')
    os.chmod(destination,0o600)
`,
        join(home, 'plugins/usage/usage.db'),
        backup,
      ],
      { stdio: 'inherit' },
    )
  if (readFileSync(path, 'utf8') !== originalText || (existsSync(patch) ? readFileSync(patch, 'utf8') : '[]\n') !== originalPatch)
    throw new Error('Profile changed during preparation; refusing to overwrite it')
  const desiredText = JSON.stringify(desired, null, 2) + '\n'
  try {
    if (changed) atomicWrite(path, desiredText)
    if (patchChanged) atomicWrite(patch, desiredPatch)
    if (changed) execFileSync('pnpm', ['--dir', profile, 'install', '--prefer-offline'], { stdio: 'inherit' })
  } catch {
    if (patchChanged && existsSync(patch) && readFileSync(patch, 'utf8') === desiredPatch) atomicWrite(patch, originalPatch)
    if (changed && readFileSync(path, 'utf8') === desiredText) {
      atomicWrite(path, originalText)
      const rollback = spawnSync('pnpm', ['--dir', profile, 'install', '--prefer-offline'], { stdio: 'inherit' })
      if (rollback.status !== 0) throw new Error(`Profile install and rollback install failed; private backup: ${backup}`)
    }
    throw new Error(`Profile preparation failed; original files restored where unchanged. Private backup: ${backup}`)
  }
  console.log(`Prepared ${selected.length} selected source bundles${patchChanged ? ' and Network access startup wiring' : ''}. Private backup: ${backup}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Source profile preparation failed')
    process.exitCode = 1
  }
}
