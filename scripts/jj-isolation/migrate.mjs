#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fenceHolds, storeRoot, workspaceHeadMap } from './guard.mjs'

/**
 * Migrates one workspace's working-copy commit onto its own leaf of a frozen
 * base revision, without rewriting any foreign working-copy revision.
 *
 * Why two modes:
 *  - `leaf-from-current` (a `@` above the base) copies the workspace's whole tree
 *    onto the base, so unlanded work survives. Rebase-shaped operations
 *    (`jj duplicate --onto`, `jj rebase -r`) re-apply only the revision's own
 *    diff and silently drop the content of the revisions between base and `@`.
 *  - `reset-to-base` (a `@` at or below the base) creates an empty leaf, because
 *    the workspace's content is already on the spine.
 *
 * The leaf is built in a scratch workspace first and adopted with a single
 * `jj edit` in the target, so the target is never left holding a tree that is
 * missing its own work: `jj edit` checks out a tree identical to the one already
 * on disk.
 */

const SKIP_DIRS = new Set(['.jj', '.git'])
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'target', '.venv', 'venv', '__pycache__', '.pnpm-store', '.cache'])
const MAX_DIGEST_FILES = 40000

const runJj = ({ cwd, args, ipc }) => {
  const result = execFileSync(process.env.JJ_ISOLATION_REAL_JJ ?? 'jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JJ_ISOLATION_ACTIVE: '1', ...ipc },
  })
  return result.trimEnd()
}

const jjTry = ({ cwd, args, ipc }) => {
  try {
    return { ok: true, stdout: runJj({ cwd, args, ipc }) }
  } catch (error) {
    return { ok: false, stderr: String(error.stderr ?? error.message) }
  }
}

const walkFiles = (workspaceRoot, visit) => {
  let seen = 0
  const walk = (dir, depth) => {
    if (depth > 10 || seen >= MAX_DIGEST_FILES) return
    let listed
    try {
      listed = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of listed.sort((left, right) => left.name.localeCompare(right.name))) {
      if (SKIP_DIRS.has(entry.name) || IGNORED_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      seen += 1
      visit(path)
    }
  }
  walk(workspaceRoot, 0)
  return seen
}

/** Listing plus content digest of everything jj tracks, used to prove nothing moved. */
export const directoryFingerprint = workspaceRoot => {
  const lines = []
  walkFiles(workspaceRoot, path => {
    let digest
    try {
      digest = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
    } catch {
      digest = `unreadable-${String(statSync(path).size)}`
    }
    lines.push(`${path.slice(workspaceRoot.length + 1)}\t${digest}`)
  })
  return lines.join('\n')
}

/** Files newer than jj's last working-copy write are changes jj has not snapshotted. */
export const dirtSample = (workspaceRoot, limit = 8) => {
  const stateDir = join(workspaceRoot, '.jj', 'working_copy')
  if (!existsSync(stateDir)) return { detected: undefined, sample: [] }
  const threshold = Math.max(...readdirSync(stateDir).map(name => statSync(join(stateDir, name)).mtimeMs))
  const sample = []
  walkFiles(workspaceRoot, path => {
    if (sample.length >= limit) return
    try {
      if (statSync(path).mtimeMs > threshold) sample.push(path.slice(workspaceRoot.length + 1))
    } catch {
      return
    }
  })
  return { detected: sample.length > 0, sample }
}

const commitOf = (cwd, revision) =>
  runJj({ cwd, args: ['log', '-r', revision, '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] }).trim()

export const workspacePathOf = (repoRoot, name) => {
  const output = execFileSync('jjw', ['list', '--format', 'json', '--with-default', '--root', dirname(repoRoot)], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const entry = (JSON.parse(output).workspaces ?? []).find(candidate => candidate.name === name)
  if (entry === undefined || typeof entry.path !== 'string') throw new Error(`jjw did not report a path for workspace '${name}'`)
  return entry.path
}

export const planMigration = ({ repoRoot, name, base, force = false, acceptGraft = false }) => {
  if (name === 'default') throw new Error('refusing to migrate `default`: it is the repository root checkout, not an agent workspace')
  const target = workspacePathOf(repoRoot, name)
  if (!existsSync(join(target, '.jj'))) throw new Error(`workspace path is not a jj workspace: ${target}`)
  const heads = workspaceHeadMap(repoRoot)
  const current = heads[name]
  if (current === undefined) throw new Error(`workspace '${name}' is not registered`)
  const baseCommit = commitOf(repoRoot, base)
  if (baseCommit.length === 0) throw new Error(`base '${base}' does not resolve`)

  const isAtOrBelowBase =
    runJj({ cwd: repoRoot, args: ['log', '-r', `${current} & ::${baseCommit}`, '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] }).trim().length > 0
  const mode = isAtOrBelowBase ? 'reset-to-base' : 'leaf-from-current'

  const descendants = runJj({ cwd: repoRoot, args: ['log', '-r', `${current}:: & ~${current}`, '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
    .split('\n')
    .filter(Boolean)
  const liveHeads = new Map(Object.entries(heads).map(([key, value]) => [value, key]))
  const foreignDescendantHeads = descendants.filter(id => liveHeads.has(id) && liveHeads.get(id) !== name).map(id => liveHeads.get(id))
  const dirt = dirtSample(target)
  const ancestors = new Set(
    runJj({ cwd: repoRoot, args: ['log', '-r', `::${current}`, '--no-graph', '-T', 'commit_id ++ "\\n"', '--ignore-working-copy'] })
      .split('\n')
      .filter(Boolean),
  )
  const liveBelow = Object.entries(heads)
    .filter(([otherName, otherCommit]) => otherName !== name && otherCommit !== current && ancestors.has(otherCommit))
    .map(([otherName]) => otherName)
  // What the leaf will contain. `restore --from` copies the whole tree, so
  // anything committed between the base and this revision by a workspace below
  // would become part of this workspace's change.
  const graftPaths =
    runJj({ cwd: repoRoot, args: ['diff', '--from', baseCommit, '--to', current, '--name-only', '--ignore-working-copy'] })
      .split('\n')
      .filter(Boolean)
  const needsGraftAck = graftPaths.length > 0 && liveBelow.length > 0

  const warnings = []
  if (mode === 'reset-to-base' && foreignDescendantHeads.length > 0) {
    warnings.push(
      `${foreignDescendantHeads.length} live working copy(s) sit above this revision (${foreignDescendantHeads.join(', ')}), but reset-to-base does not rewrite it`,
    )
  }
  if (needsGraftAck) {
    warnings.push(
      `the leaf will contain ${graftPaths.length} path(s) that also sit above ${liveBelow.join(', ')} (${graftPaths.slice(0, 4).join(', ')}). Confirm they are this workspace's own work; nothing distinguishes authorship in jj.`,
    )
  }

  const blockers = []
  // Snapshotting a `@` that holds unlanded work rewrites it and rebases its
  // descendants. reset-to-base never touches the old `@`, so it has no such
  // precondition; it only requires a clean working copy.
  if (mode === 'leaf-from-current' && foreignDescendantHeads.length > 0) {
    blockers.push(
      `${foreignDescendantHeads.length} live working-copy revision(s) sit above this workspace (${foreignDescendantHeads.join(', ')}): migrate those first`,
    )
  }
  if (needsGraftAck && !acceptGraft) {
    blockers.push(`the migrated change would graft ${graftPaths.length} path(s) from ${liveBelow.join(', ')}; pass --accept-graft once the plan's warnings have been reviewed`)
  }
  if (dirt.detected === true && mode === 'reset-to-base' && !force) {
    blockers.push(
      `possible unsnapshotted changes (${dirt.sample.length}: ${dirt.sample.slice(0, 3).join(', ')}); this @ is at or below the spine, so a snapshot would rebase the spine. Land or capture them first`,
    )
  }

  return {
    workspace: name,
    path: target,
    head: current,
    base: baseCommit,
    baseName: base,
    mode,
    descendantCount: descendants.length,
    foreignDescendantHeads,
    dirt,
    graftPaths: graftPaths.slice(0, 20),
    graftPathCount: graftPaths.length,
    liveWorkspacesBelow: liveBelow,
    warnings,
    blockers,
    steps: blockers.length > 0 ? [] : [
      `checkpoint: record @ = ${current.slice(0, 12)}, the directory digest, and the fence`,
      mode === 'leaf-from-current'
        ? 'snapshot this workspace so its @ holds the on-disk content (safe: no live working copy sits above it)'
        : 'create an empty leaf on the base (content is already on the spine); no snapshot, so no ancestor is rewritten',
      `create a scratch workspace pinned to ${baseCommit.slice(0, 12)}${mode === 'leaf-from-current' ? ` and copy @'s whole tree with jj restore --from ${current.slice(0, 12)}` : ''}`,
      `describe the leaf and adopt it in ${name} with one jj edit (checks out an identical tree)`,
      'verify: directory digest unchanged, no foreign working-copy revision moved, @ has no descendants',
      'forget and remove the scratch workspace',
    ],
  }
}

export const applyMigration = ({ repoRoot, name, plan, gate, onEvent = () => {} }) => {
  const events = []
  const emit = message => {
    events.push(message)
    onEvent(message)
  }
  if (plan.blockers.length > 0) throw new Error(`refusing to migrate ${name}: ${plan.blockers.join(' | ')}`)

  const ipc = gate === undefined ? {} : { JJ_ISOLATION_MAINTENANCE_TOKEN: gate.token }
  if (gate !== undefined) {
    const fence = fenceHolds(repoRoot, gate)
    if (!fence.ok) {
      const moved = fence.drifted.map(([key]) => key).concat(fence.appeared.map(([key]) => key))
      throw new Error(
        `maintenance fence broke before migrating ${name}: op ${fence.current.opId.slice(0, 12)}` +
          `${moved.length > 0 ? ` and workspace heads moved (${moved.join(', ')})` : ''}. Re-run preflight and re-arm.`,
      )
    }
  }

  const target = plan.path
  const before = directoryFingerprint(target)
  const headsBefore = workspaceHeadMap(repoRoot)
  const scratchName = `mig-${name}-${randomUUID().slice(0, 8)}`
  const scratchPath = join(dirname(repoRoot), scratchName)

  let head = plan.head
  if (plan.mode === 'leaf-from-current') {
    runJj({ cwd: target, args: ['status'], ipc })
    head = commitOf(target, '@')
    emit(`snapshot: ${name} @ = ${head.slice(0, 12)}`)
  }

  let leaf
  let scratchCreated = false
  try {
    runJj({ cwd: target, args: ['workspace', 'add', scratchPath, '--name', scratchName, '-r', plan.base], ipc })
    scratchCreated = true
    emit(`scratch: ${scratchName} at ${scratchPath}`)
    if (plan.mode === 'leaf-from-current') {
      runJj({ cwd: scratchPath, args: ['restore', '--from', head], ipc })
      emit(`leaf tree copied from ${head.slice(0, 12)}`)
    }
    runJj({ cwd: scratchPath, args: ['describe', '-m', `chore(jj): workspace leaf for ${name}`], ipc })
    leaf = commitOf(scratchPath, '@')
    const graft = runJj({ cwd: repoRoot, args: ['diff', '--from', plan.base, '--to', leaf, '--name-only', '--ignore-working-copy'] })
      .split('\n')
      .filter(Boolean)
    emit(`leaf ${leaf.slice(0, 12)}; own change vs base: ${graft.length} path(s)${graft.length > 0 ? ` (${graft.slice(0, 5).join(', ')})` : ''}`)

    runJj({ cwd: target, args: ['edit', leaf], ipc })
    emit(`adopted leaf in ${name}`)
  } catch (error) {
    if (scratchCreated) {
      jjTry({ cwd: repoRoot, args: ['workspace', 'forget', scratchName], ipc })
      if (existsSync(scratchPath)) rmSync(scratchPath, { recursive: true, force: true })
      emit('scratch removed after failure')
    }
    throw error
  }

  const after = directoryFingerprint(target)
  if (before !== after) {
    const rollback = jjTry({ cwd: target, args: ['edit', head], ipc })
    jjTry({ cwd: repoRoot, args: ['workspace', 'forget', scratchName], ipc })
    if (existsSync(scratchPath)) rmSync(scratchPath, { recursive: true, force: true })
    throw new Error(
      `directory content changed while migrating ${name}; ${rollback.ok ? `rolled @ back to ${head.slice(0, 12)}` : `ROLLBACK FAILED — run: jj edit ${head} inside ${target}`}. ` +
        'The pre-migration revision is intact in the store.',
    )
  }

  const headsAfter = workspaceHeadMap(repoRoot)
  const drifted = Object.keys(headsBefore).filter(key => key !== name && key !== scratchName && headsBefore[key] !== headsAfter[key])
  if (drifted.length > 0) throw new Error(`foreign working-copy revisions moved during migration: ${drifted.join(', ')}`)

  const descendants = runJj({ cwd: repoRoot, args: ['log', '-r', `${leaf}:: & ~${leaf}`, '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })
    .split('\n')
    .filter(Boolean)
  emit(`@ is a leaf: ${descendants.length === 0 ? 'yes' : `NO (${descendants.length} descendants)`}`)

  jjTry({ cwd: repoRoot, args: ['workspace', 'forget', scratchName], ipc })
  if (existsSync(scratchPath)) rmSync(scratchPath, { recursive: true, force: true })
  emit('scratch removed')

  return {
    workspace: name,
    mode: plan.mode,
    before: head,
    after: leaf,
    base: plan.base,
    directoryDigestStable: true,
    leafHasNoDescendants: descendants.length === 0,
    rollback: `jj edit ${head}   # run inside ${target}`,
    recovery: `revision ${head.slice(0, 12)} remains in the store with the full pre-migration tree`,
    events,
  }
}
