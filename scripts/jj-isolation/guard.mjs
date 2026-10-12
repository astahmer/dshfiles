#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Concurrent-workspace isolation guard for a shared Jujutsu store.
 *
 * The failure it prevents: two processes rewriting the same change at the same
 * time produces a divergent change (one change id, several commit ids). The
 * next command in the workspace that owns that change runs jj's stale-working-
 * copy recovery, checks out whichever copy won the operation merge, and the
 * files that were only snapshotted by the losing copy are deleted from the
 * working directory. jj reports it as "Updated working copy to fresh commit".
 *
 * The invariant this module enforces: a mutating command may not rewrite a
 * commit that another live workspace holds as its `@`, because that is the only
 * way a foreign process can change a workspace's working-copy commit id.
 *
 * Every jj call here passes `--ignore-working-copy`, so the guard is never
 * itself a writer.
 */

export const MUTATING_SUBCOMMANDS = Object.freeze([
  'abandon',
  'describe',
  'split',
  'squash',
  'rebase',
  'restore',
  'workspace forget',
  'workspace add',
  'bookmark set',
  'bookmark move',
  'bookmark create',
  'op restore',
  'op revert',
  'util gc',
])

const VALUE_FLAGS = new Set([
  '-R',
  '--repository',
  '--at-operation',
  '--at-op',
  '--color',
  '--config',
  '--config-toml',
  '--template',
  '-T',
  '--limit',
  '-m',
  '--message',
  '--author',
  '--reset-author',
  '--destination',
  '-d',
  '--onto',
  '--from',
])

const TWO_TOKEN_SUBCOMMANDS = new Set(['workspace', 'bookmark', 'op', 'util', 'git', 'file', 'log', 'duplicate'])

const flagValue = (argv, index) => {
  const token = argv[index]
  if (token.includes('=')) return token.slice(token.indexOf('=') + 1)
  return argv[index + 1]
}

/** Splits argv into the global-flag prefix, the subcommand path, and the rest. */
export const parseArgv = argv => {
  let index = 0
  while (index < argv.length) {
    const token = argv[index]
    if (!token.startsWith('-')) break
    if (token.includes('=') || !VALUE_FLAGS.has(token)) {
      index += 1
      continue
    }
    index += 2
  }
  const first = argv[index]
  if (first === undefined) return { subcommand: '', rest: [] }
  const second = argv[index + 1]
  if (TWO_TOKEN_SUBCOMMANDS.has(first) && second !== undefined && !second.startsWith('-')) {
    return { subcommand: `${first} ${second}`, rest: argv.slice(index + 2) }
  }
  return { subcommand: first, rest: argv.slice(index + 1) }
}

const collectFlagValues = (rest, names) => {
  const values = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
    if (!names.includes(name)) continue
    const value = flagValue(rest, index)
    if (typeof value === 'string' && !value.startsWith('-')) values.push(value)
  }
  return values
}

const collectPositional = rest => {
  const values = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token.startsWith('-')) {
      if (!token.includes('=') && VALUE_FLAGS.has(token)) index += 1
      continue
    }
    values.push(token)
  }
  return values
}

/** Removes every occurrence of the named flags and their values. */
const stripFlag = (rest, names) => {
  const kept = []
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
    if (names.includes(name)) {
      if (!token.includes('=')) index += 1
      continue
    }
    kept.push(token)
  }
  return kept
}

/**
 * The revsets a command rewrites. Rewriting `X` also rebases `X`'s descendants,
 * so the guard turns this list into the footprint `(a | b | …)::`.
 */
export const rewriteTargets = argv => {
  const { subcommand, rest } = parseArgv(argv)
  const whenNoTarget = ['@']
  switch (subcommand) {
    case 'describe':
    case 'abandon': {
      const positional = collectPositional(rest)
      return positional.length === 0 ? whenNoTarget : positional
    }
    case 'split':
      return [...collectFlagValues(rest, ['-r', '--revision']), ...whenNoTarget].slice(0, 1)
    case 'squash': {
      const from = collectFlagValues(rest, ['--from'])
      const into = collectFlagValues(rest, ['--into'])
      return [...(from.length === 0 ? whenNoTarget : from), ...into]
    }
    case 'rebase': {
      const sources = collectFlagValues(rest, ['-s', '--source', '-b', '--branch', '-r', '--revision', '--base'])
      return sources.length === 0 ? whenNoTarget : sources
    }
    case 'restore': {
      const changesIn = collectFlagValues(rest, ['--changes-in'])
      if (changesIn.length > 0) return changesIn
      const into = collectFlagValues(rest, ['--into'])
      return into.length === 0 ? whenNoTarget : into
    }
    default:
      return []
  }
}

export const parseWorkspaceHeads = stdout =>
  stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const [name = '', commit = ''] = line.split('\t')
      return { name, commit }
    })
    .filter(entry => entry.commit.length > 0)

export const parseCommitIds = stdout =>
  new Set(
    stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^[0-9a-f]{40,64}$/.test(line)),
  )

const WORKSPACE_TEMPLATE = 'name ++ "\\t" ++ target.commit_id() ++ "\\n"'

export const readJj = ({ args, cwd }) => {
  try {
    return execFileSync(process.env.JJ_ISOLATION_REAL_JJ ?? 'jj', ['--ignore-working-copy', ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, JJ_ISOLATION_ACTIVE: '1' },
    }).trimEnd()
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    throw new Error(`jj ${args.join(' ')} failed: ${stderr || error.message}`)
  }
}

export const workspaceHeads = cwd => parseWorkspaceHeads(readJj({ args: ['workspace', 'list', '-T', WORKSPACE_TEMPLATE], cwd }))

export const currentHead = cwd => readJj({ args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id'], cwd }).trim()

export const resolveCommitId = (cwd, revision) => readJj({ args: ['log', '-r', revision, '--no-graph', '-T', 'commit_id'], cwd }).trim().split('\n')[0]?.trim() ?? ''

const resolveCommitIdOrEmpty = (cwd, revision) => {
  try {
    return resolveCommitId(cwd, revision)
  } catch {
    return ''
  }
}

export const rewriteFootprint = (cwd, targets) => {
  const revset = targets.length === 1 ? `${targets[0]}::` : `(${targets.join(' | ')})::`
  return parseCommitIds(readJj({ args: ['log', '-r', revset, '--no-graph', '-T', 'commit_id ++ "\\n"'], cwd }))
}

const escapeRevset = name => `bookmarks(exact:"${name.replace(/["\\]/g, '\\$&')}")`

export const bookmarkTarget = (cwd, name) => readJj({ args: ['log', '-r', escapeRevset(name), '--no-graph', '-T', 'commit_id'], cwd }).trim().split('\n')[0]?.trim() ?? ''

export const isAncestorOf = (cwd, ancestor, descendant) => {
  if (ancestor.length === 0 || descendant.length === 0) return false
  return readJj({ args: ['log', '-r', `${ancestor} & ::${descendant}`, '--no-graph', '-T', 'commit_id'], cwd }).trim().length > 0
}

export const storeRoot = workspaceRoot => {
  const marker = join(workspaceRoot, '.jj', 'repo')
  if (!existsSync(marker)) return workspaceRoot
  const contents = readFileSync(marker, 'utf8').trim()
  if (contents.length === 0) return workspaceRoot
  return isAbsolute(contents) ? contents : resolve(workspaceRoot, contents)
}

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  base: 'integration-spine',
  enforceWorkspaceBase: true,
  enforceForeignRewrite: true,
  enforceCanonicalBookmarks: true,
  canonicalBookmarks: ['main', 'integration-spine'],
  enforceRepoWideRefusal: true,
})

export const readConfig = cwd => {
  const explicit = process.env.JJ_ISOLATION_CONFIG
  const candidates = explicit === undefined ? [join(cwd, '.jj', 'jj-isolation.json')] : [explicit]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(path, 'utf8')) }
    } catch (error) {
      throw new Error(`jj-isolation: config at ${path} is unreadable: ${error.message}`)
    }
  }
  return undefined
}

export const isEnabled = cwd => {
  const mode = (process.env.JJ_ISOLATION ?? '').trim()
  if (mode === 'off' || mode === '0' || mode === 'false') return false
  if (mode === 'on' || mode === '1' || mode === 'true') return true
  return readConfig(cwd) !== undefined
}

const allow = reason => ({ decision: 'allow', reason })
const refuse = (code, reason, detail) => ({ decision: 'refuse', code, reason, detail })
const rewrite = (code, reason, argv) => ({ decision: 'rewrite', code, reason, argv })

const isFullCommitId = value => /^[0-9a-f]{40,64}$/.test(value)

/** Rules that need only jj's own state; `argv` is the post-subcommand arg list. */
export const evaluate = ({ cwd, argv }) => {
  const { subcommand, rest } = parseArgv(argv)
  if (!MUTATING_SUBCOMMANDS.includes(subcommand)) return allow('not-a-mutating-subcommand')
  const config = readConfig(cwd) ?? DEFAULT_CONFIG

  if (subcommand === 'op restore' || subcommand === 'op revert' || subcommand === 'util gc') {
    if (process.env.JJ_ISOLATION_ALLOW_REPO_WIDE === '1') return allow('repo-wide-override')
    return refuse(
      'repo-wide-refused',
      `${subcommand} rewrites the shared operation log and can discard every other agent's operations.`,
      'Set JJ_ISOLATION_ALLOW_REPO_WIDE=1 only when no other agent is working in this store.',
    )
  }

  if (subcommand === 'workspace add') {
    const requested = collectFlagValues(rest, ['-r', '--revision'])
    if (!config.enforceWorkspaceBase) return allow('workspace-base-not-enforced')
    const base = resolveCommitId(cwd, config.base)
    if (base.length === 0) {
      return refuse(
        'base-unresolved',
        `Workspace base '${config.base}' does not resolve, so a new workspace cannot be pinned to an immutable revision.`,
        'Set the base bookmark (or JJ_ISOLATION_BASE) before creating workspaces.',
      )
    }
    const liveHeads = new Set(workspaceHeads(cwd).map(entry => entry.commit))
    const requestedCommit = requested.length === 0 ? '' : resolveCommitIdOrEmpty(cwd, requested[0])
    if (requestedCommit.length > 0 && requestedCommit === base) return allow('pinned-to-base')
    if (requestedCommit.length > 0 && !liveHeads.has(requestedCommit)) return allow('base-is-not-a-live-working-copy')
    if (process.env.JJ_ISOLATION_ALLOW_CHAINED_WORKSPACE === '1') return allow('chained-workspace-override')
    const why =
      requested.length === 0
        ? 'no base was given, which chains the new workspace onto the mutable parent of the caller'
        : `base ${requested[0]} resolves to a revision another live workspace is working on`
    return rewrite(
      'pin-workspace-base',
      `Pinned the new workspace to immutable commit ${base.slice(0, 12)} (${config.base}) because ${why}; a workspace stacked on a mutable working copy goes stale as soon as that revision is rewritten.`,
      ['workspace', 'add', ...stripFlag(rest, ['-r', '--revision']), '--revision', base],
    )
  }

  if (subcommand === 'workspace forget') {
    const name = collectPositional(rest)[0]
    if (name === undefined) return allow('forget-without-name')
    const heads = workspaceHeads(cwd).filter(entry => entry.name === name)
    if (heads.length === 0) return allow('unknown-workspace')
    const proof = process.env.JJ_ISOLATION_FORGET_PROOF
    if (proof === heads[0].commit) return allow('forget-proof-matches')
    return refuse(
      'forget-needs-proof',
      `Refusing to forget workspace '${name}' (${heads[0].commit.slice(0, 12)}) without a proof that its directory holds no unsnapshotted work.`,
      `Run the sweep (pnpm run jj:sweep --apply), which proves the recorded working-copy commit matches before forgetting, or set JJ_ISOLATION_FORGET_PROOF=${heads[0].commit} after checking by hand.`,
    )
  }

  if (subcommand === 'bookmark set' || subcommand === 'bookmark move' || subcommand === 'bookmark create') {
    if (!config.enforceCanonicalBookmarks) return allow('canonical-bookmarks-not-enforced')
    const name = collectPositional(rest)[0]
    if (name === undefined || !config.canonicalBookmarks.includes(name)) return allow('not-a-canonical-bookmark')
    if (process.env.JJ_ISOLATION_ALLOW_BOOKMARK_REWIND === '1') return allow('bookmark-override')
    const target = collectFlagValues(rest, ['-r', '--to', '--revision'])[0] ?? '@'
    const current = bookmarkTarget(cwd, name)
    if (current.length === 0) return allow('bookmark-not-yet-created')
    const next = resolveCommitId(cwd, target)
    if (next.length === 0) return allow('bookmark-target-unresolved')
    if (isAncestorOf(cwd, current, next)) return allow('forward-move')
    return refuse(
      'bookmark-rewind',
      `Refusing to move canonical bookmark '${name}' from ${current.slice(0, 12)} to ${next.slice(0, 12)}, which is not a descendant: another writer may have advanced it.`,
      'Re-read the bookmark and integrate onto its current target, or set JJ_ISOLATION_ALLOW_BOOKMARK_REWIND=1 for a deliberate rewind.',
    )
  }

  const targets = rewriteTargets(argv)
  if (targets.length === 0) return allow('no-rewrite-footprint')
  if (!config.enforceForeignRewrite) return allow('foreign-rewrite-not-enforced')
  if (process.env.JJ_ISOLATION_ALLOW_FOREIGN_REWRITE === '1') return allow('foreign-rewrite-override')

  const selfHead = currentHead(cwd)
  const foreign = workspaceHeads(cwd).filter(entry => entry.commit !== selfHead)
  if (foreign.length === 0) return allow('no-foreign-workspaces')
  const footprint = rewriteFootprint(cwd, targets)
  const collisions = foreign.filter(entry => footprint.has(entry.commit))
  if (collisions.length === 0) return allow('footprint-misses-foreign-workspaces')
  const named = collisions.map(entry => `${entry.name} (${entry.commit.slice(0, 12)})`).join(', ')
  return refuse(
    'foreign-working-copy-rewrite',
    `${subcommand} would rewrite the working-copy revision of another live workspace: ${named}.`,
    'Rewriting a foreign working-copy revision races its owner snapshot and can end in a divergent change whose checkout deletes their uncommitted files. Work on your own revision, or coordinate the owner first. JJ_ISOLATION_ALLOW_FOREIGN_REWRITE=1 overrides for an authorized consolidation.',
  )
}
