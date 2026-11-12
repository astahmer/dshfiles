import { spawnSync } from 'node:child_process'
import { basename, isAbsolute, join, resolve } from 'node:path'

// A DSH Host is a dsh core CLI: the configured entry, any `dsh` bin shim (`dsh-runtime/node_modules/.bin/dsh`,
// a global `dsh`) or the package's own `dsh/lib/bin.js`, however it was started.
const isCoreToken = (token, coreEntry) => token === coreEntry || basename(token) === 'dsh' || /(^|\/)dsh\/lib\/bin\.js$/.test(token)

// DSH boots `--profile <name>`, `--profile=<name>`, or `dsh <name>` when the first argument is not a flag or `plugin`.
const selectsProfile = (args, profile) =>
  args[0] === profile || args.some((token, index) => token === `--profile=${profile}` || (token === '--profile' && args[index + 1] === profile))

/** The process environment `ps e` appends after argv: the exact value of one variable, or undefined. */
const environmentValue = (line, name) => {
  const start = line.lastIndexOf(` ${name}=`)
  if (start === -1) return undefined
  const rest = line.slice(start + name.length + 2)
  // Values follow one another separated by a space and the next NAME=; a value may itself contain spaces.
  const next = rest.search(/ [A-Za-z_][A-Za-z0-9_]*=/)
  return next === -1 ? rest : rest.slice(0, next)
}

const homeOf = line => {
  const dshHome = environmentValue(line, 'DSH_HOME')?.trim()
  if (dshHome) {
    if (dshHome === '~' || dshHome.startsWith('~/')) {
      const home = environmentValue(line, 'HOME')
      return home === undefined ? undefined : join(home, dshHome.slice(2))
    }
    // A relative DSH_HOME resolves against that process's working directory, which ps does not show.
    return isAbsolute(dshHome) ? resolve(dshHome) : undefined
  }
  const home = environmentValue(line, 'HOME')
  return home === undefined ? undefined : join(home, '.dsh')
}

/**
 * Parse `ps axeww -o pid=,uid=,command=` output into the pids of Hosts that serve `home`/`profile` for `uid`. A Host whose
 * home cannot be established (no visible environment, relative DSH_HOME) counts as a match: the caller refuses rather
 * than relinking a profile a Host may be using.
 */
export function matchingHostPids(psText, { home, profile, coreEntry, uid }) {
  const target = resolve(home)
  const pids = []
  for (const raw of psText.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(raw)
    if (!match || Number(match[2]) !== uid) continue
    const line = match[3]
    const tokens = line.split(/\s+/)
    const core = tokens.findIndex(token => isCoreToken(token, coreEntry))
    if (core === -1 || core > 2) continue
    const args = tokens.slice(core + 1)
    if (args[0] === 'plugin' || !selectsProfile(args, profile)) continue
    const served = homeOf(` ${line}`)
    if (served === undefined || resolve(served) === target) pids.push(Number(match[1]))
  }
  return pids
}

/** Pids of running Hosts for this home and profile. Throws when the process table cannot be read. */
export function runningHostPids({ home, profile, coreEntry, env = process.env, uid = process.getuid() }) {
  const result = spawnSync('ps', ['axeww', '-o', 'pid=,uid=,command='], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Could not check running DSH processes; nothing started')
  return matchingHostPids(result.stdout, { home, profile, coreEntry, uid })
}
