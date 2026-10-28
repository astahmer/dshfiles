import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

function commit(repo, ref) {
  return git(repo, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
}

function paths(repo, ref) {
  return git(repo, 'ls-tree', '-r', '-z', '--name-only', ref).split('\0').filter(Boolean)
}

function changed(repo, from, to) {
  // Disable rename detection: moving a plugin must count as both deletion and addition.
  return new Set(git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', from, to).split('\0').filter(Boolean))
}

function pluginNames(files) {
  return new Set(
    files.flatMap(path => {
      const match = /^plugins\/@dshfiles\/([^/]+)\/package\.json$/.exec(path)
      return match ? [match[1]] : []
    }),
  )
}

function validatePolicy(policy) {
  if (policy.schemaVersion !== 1 || !policy.plugins || typeof policy.plugins !== 'object' || Array.isArray(policy.plugins)) {
    throw new Error('Expected fork-policy.json schemaVersion 1 and a plugins object')
  }
  if (
    !Array.isArray(policy.forkOnlyPaths) ||
    policy.forkOnlyPaths.some(path => typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..'))
  ) {
    throw new Error('forkOnlyPaths must contain repository-relative paths')
  }
  for (const [name, entry] of Object.entries(policy.plugins)) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(name) ||
      !entry ||
      !['shared', 'owned'].includes(entry.ownership) ||
      !['keep-local', 'candidate', 'proposed', 'accepted'].includes(entry.upstreamIntent) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    ) {
      throw new Error(`Invalid ownership decision for plugin ${name}`)
    }
  }
}

export function auditFork({ repo, upstream, local = 'HEAD', policy }) {
  validatePolicy(policy)
  const localCommit = commit(repo, local)
  const upstreamCommit = commit(repo, upstream)
  const bases = git(repo, 'merge-base', '--all', localCommit, upstreamCommit).split('\n').filter(Boolean)
  if (bases.length !== 1) throw new Error('Expected exactly one merge base; inspect unrelated or criss-cross history manually')
  const base = bases[0]
  const basePlugins = pluginNames(paths(repo, base))
  const localPlugins = pluginNames(paths(repo, localCommit))
  const upstreamPlugins = pluginNames(paths(repo, upstreamCommit))
  const localChanges = changed(repo, base, localCommit)
  const upstreamChanges = changed(repo, base, upstreamCommit)
  const delta = changed(repo, upstreamCommit, localCommit)
  const names = new Set([...basePlugins, ...localPlugins, ...upstreamPlugins, ...Object.keys(policy.plugins)])
  const touches = (files, name) => [...files].some(path => path.startsWith(`plugins/@dshfiles/${name}/`))
  const plugins = [...names].sort().map(name => {
    const decision = policy.plugins[name]
    const inBase = basePlugins.has(name)
    const inLocal = localPlugins.has(name)
    const inUpstream = upstreamPlugins.has(name)
    const localChanged = touches(localChanges, name)
    const upstreamChanged = touches(upstreamChanges, name)
    return {
      name,
      ownership: decision?.ownership ?? (inBase || inUpstream ? 'shared' : 'needs-classification'),
      upstreamIntent: decision?.upstreamIntent ?? null,
      reason: decision?.reason ?? null,
      inBase,
      inLocal,
      inUpstream,
      localChanged,
      upstreamChanged,
      differsFromUpstream: touches(delta, name),
      concurrentChanges: localChanged && upstreamChanged,
      nameCollision: !inBase && inLocal && inUpstream,
      ownershipReview: decision?.ownership === 'owned' && inUpstream,
    }
  })
  const pluginPath = /^plugins\/@dshfiles\/[^/]+\//
  return {
    base,
    local: localCommit,
    upstream: upstreamCommit,
    // Contents and values are never read. Uncommitted changes are not classified as committed deltas.
    dirtyStatus: git(repo, 'status', '--short', '--untracked-files=normal'),
    plugins,
    sharedFileDelta: [...delta].filter(path => !pluginPath.test(path)).sort(),
    forkOnlyPathDelta: [...delta].filter(path => policy.forkOnlyPaths.some(owned => (owned.endsWith('/') ? path.startsWith(owned) : path === owned))).sort(),
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: node scripts/fork-audit.mjs --upstream <fetched-ref> [--local HEAD] [--repo <path>] [--policy <path>]\nRead-only JSON report. No fetch, merge, push, build, or profile writes. The policy is read from disk, not from --local.',
    )
    return
  }
  const options = { repo: process.cwd(), local: 'HEAD' }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!['--repo', '--local', '--upstream', '--policy'].includes(flag) || !value || value.startsWith('--')) throw new Error(`Invalid argument: ${flag}`)
    options[flag.slice(2)] = value
  }
  if (!options.upstream) throw new Error('--upstream is required; fetch and verify the intended upstream first')
  const policy = JSON.parse(readFileSync(resolve(options.repo, options.policy ?? 'fork-policy.json'), 'utf8'))
  console.log(JSON.stringify(auditFork({ ...options, policy }), null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    // Do not print child-process error objects: they can include unexpected remote output.
    console.error(error instanceof Error ? error.message.split('\n')[0] : 'Fork audit failed')
    process.exitCode = 1
  }
}
