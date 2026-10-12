#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { readMaintenance, readJj, storeRoot, workspaceHeadMap } from './guard.mjs'

/**
 * Read-only repository preflight.
 *
 * Every jj call passes --ignore-working-copy, so producing this report never
 * snapshots, rewrites or checks out anything. Dirt is therefore reported as a
 * heuristic based on file mtimes versus jj's own working-copy state file:
 * "detected" is reliable, "not-detected" is not proof of cleanliness. Proving
 * cleanliness needs a preserving snapshot, which the sweep does behind
 * --prove-clean and this report deliberately does not.
 */

const IGNORED_DIRS = new Set(['.jj', '.git', 'node_modules', 'dist', 'target', '.venv', 'venv', '__pycache__', '.pnpm-store', '.cache'])
const DIRT_SKIP_DIRS = new Set(['.jj', '.git'])

const newestStateMtime = workspaceRoot => {
  const dir = join(workspaceRoot, '.jj', 'working_copy')
  if (!existsSync(dir)) return undefined
  const times = readdirSync(dir).map(name => statSync(join(dir, name)).mtimeMs)
  return times.length === 0 ? undefined : Math.max(...times)
}

/** Files newer than jj's last working-copy write are changes jj has not snapshotted. */
const dirtySample = (workspaceRoot, limit = 12) => {
  const threshold = newestStateMtime(workspaceRoot)
  if (threshold === undefined) return { detected: undefined, count: 0, sample: [] }
  const sample = []
  let count = 0
  const walk = (dir, depth) => {
    if (depth > 6 || count >= 4000) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && DIRT_SKIP_DIRS.has(entry.name)) continue
      if (IGNORED_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      count += 1
      let mtime
      try {
        mtime = statSync(path).mtimeMs
      } catch {
        continue
      }
      if (mtime > threshold && sample.length < limit) sample.push(path.slice(workspaceRoot.length + 1))
    }
  }
  walk(workspaceRoot, 0)
  return { detected: sample.length > 0, count, sample }
}

const ancestorsOf = (cwd, revision) =>
  new Set(
    readJj({ args: ['log', '-r', `::${revision}`, '--no-graph', '-T', 'commit_id ++ "\\n"'], cwd })
      .split('\n')
      .filter(Boolean),
  )

const descendantsOf = (cwd, revision) =>
  readJj({ args: ['log', '-r', `${revision}:: & ~${revision}`, '--no-graph', '-T', 'commit_id ++ "\\n"'], cwd })
    .split('\n')
    .filter(Boolean)

/**
 * `jj workspace list` does not report paths. jjw (already a repository
 * dependency for `pnpm run jj:sweep`) does, and its jj calls are all
 * `--ignore-working-copy`, so this stays read-only.
 */
const discoverWorkspacePaths = (repoRoot, store) => {
  const map = new Map([['default', repoRoot]])
  try {
    const output = execFileSync('jjw', ['list', '--format', 'json', '--with-default', '--root', dirname(repoRoot)], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    for (const entry of JSON.parse(output).workspaces ?? []) {
      if (typeof entry.name === 'string' && typeof entry.path === 'string') map.set(entry.name, entry.path)
    }
    return { map, source: 'jjw' }
  } catch {
    // Fall back to jj's own workspace index: `<name> <path relative to the store>`.
    try {
      const index = readFileSync(join(store, 'workspace_store', 'index'), 'utf8')
      const pairs = index.match(/[^\s/]+\s+\.\.?\/[^\s]*/g) ?? []
      for (const pair of pairs) {
        const [name, relative] = pair.split(/\s+/)
        if (name !== undefined && relative !== undefined) map.set(name, resolve(store, relative))
      }
      return { map, source: 'store-index' }
    } catch {
      return { map, source: 'unavailable' }
    }
  }
}

const jjProcessLines = () => {
  try {
    const output = execFileSync('ps', ['-Ao', 'pid=,etime=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    return output
      .split('\n')
      .filter(line => /(^|\/)jj( |$)/.test(line) && !line.includes('ps -Ao'))
      .map(line => line.trim().slice(0, 240))
  } catch {
    return []
  }
}

const MUTATING_TOKEN = /\s(describe|split|squash|rebase|abandon|restore|new|edit|commit|duplicate|revert|workspace\s+(add|forget)|bookmark\s+(set|move|create|delete)|op\s+(restore|revert))([\s'"]|$)/

/** A long-running branching server is normal; an in-flight mutation is not. */
export const mutatingJjProcesses = lines => lines.filter(line => MUTATING_TOKEN.test(line))

/** Commits between two revisions, newest first, with their descriptions. */
const commitsBetween = (cwd, from, to, limit = 12) =>
  readJj({ args: ['log', '-r', `${from}..${to}`, '--no-graph', '-T', 'commit_id ++ "\\t" ++ description.first_line() ++ "\\n"'], cwd })
    .split('\n')
    .filter(Boolean)
    .slice(0, limit)
    .map(line => {
      const [commit = '', ...rest] = line.split('\t')
      return { commit, description: rest.join('\t') }
    })

/**
 * jj records no authorship, so the only way to tell whose work a grafted path is
 * is to show which commits above the base touch it.
 */
const attributeGraft = (cwd, base, head, graftPaths) => {
  const wanted = new Set(graftPaths)
  if (wanted.size === 0) return {}
  const attribution = {}
  for (const entry of commitsBetween(cwd, base, head)) {
    const touched = readJj({ args: ['diff', '-r', entry.commit, '--name-only'], cwd }).split('\n').filter(Boolean)
    for (const path of touched) {
      if (!wanted.has(path)) continue
      const owners = attribution[path] ?? []
      if (owners.length < 3) owners.push(`${entry.commit.slice(0, 8)} ${entry.description.slice(0, 48)}`)
      attribution[path] = owners
    }
  }
  return attribution
}

const recentOperation = (cwd, seconds) => {
  const rows = readJj({
    args: ['op', 'log', '-n', '5', '--no-graph', '-T', 'self.time().start().local().format("%Y-%m-%dT%H:%M:%S") ++ "\\t" ++ description.first_line() ++ "\\n"'],
    cwd,
  })
  const cutoff = Date.now() - seconds * 1000
  return rows
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [stamp = '', ...rest] = line.split('\t')
      return { stamp, description: rest.join('\t'), at: Date.parse(stamp) }
    })
    .filter(entry => Number.isFinite(entry.at))
    .map(entry => ({ ...entry, ageSeconds: Math.round((Date.now() - entry.at) / 1000), recent: entry.at > cutoff }))
}

export const buildPreflight = ({ cwd, quietSeconds = 120, dirtLimit = 12 }) => {
  const repoRoot = readJj({ args: ['root'], cwd })
  const store = storeRoot(repoRoot)
  const { map: workspacePaths, source: pathSource } = discoverWorkspacePaths(repoRoot, store)
  const heads = workspaceHeadMap(cwd)
  const spineName = process.env.JJ_ISOLATION_BASE ?? 'integration-spine'
  const spineCommit = (() => {
    try {
      return readJj({ args: ['log', '-r', spineName, '--no-graph', '-T', 'commit_id'], cwd }).trim().split('\n')[0] ?? ''
    } catch {
      return ''
    }
  })()
  const onSpine = spineCommit.length === 0 ? new Set() : ancestorsOf(cwd, spineCommit)
  const aboveSpine = spineCommit.length === 0
    ? []
    : readJj({ args: ['log', '-r', `${spineCommit}:: & ~${spineCommit}`, '--no-graph', '-T', 'commit_id ++ "\\n"'], cwd })
        .split('\n')
        .filter(Boolean)

  const baseForMigration = spineCommit
  const basePaths =
    spineCommit.length === 0
      ? new Set()
      : new Set(
          readJj({ args: ['file', 'list', '-r', spineCommit, '-T', 'path ++ "\\n"'], cwd })
            .split('\n')
            .filter(Boolean),
        )
  const report = []
  for (const [name, commit] of Object.entries(heads)) {
    const candidateRoot = workspacePaths.get(name)
    const resolvedRoot = candidateRoot !== undefined && existsSync(join(candidateRoot, '.jj')) ? candidateRoot : undefined
    const descendants = descendantsOf(cwd, commit)
    const foreignDescendants = descendants.filter(id => Object.values(heads).includes(id) && id !== commit)
    const foreignDescendantNames = foreignDescendants.map(id => Object.entries(heads).find(([, value]) => value === id)?.[0] ?? id)
    const empty = readJj({ args: ['log', '-r', commit, '--no-graph', '-T', 'empty'], cwd }).trim() === 'true'
    const conflict = readJj({ args: ['log', '-r', commit, '--no-graph', '-T', 'conflict'], cwd }).trim() === 'true'
    const changedPaths = readJj({ args: ['diff', '--from', `${commit}-`, '--to', commit, '--name-only'], cwd })
      .split('\n')
      .filter(Boolean)
    // What the migrated leaf will contain: everything between the frozen base and
    // this working copy. Work committed by a workspace below would be grafted into
    // this workspace's change, so it is reported and warned about.
    const ancestors = ancestorsOf(cwd, commit)
    const graftPaths =
      baseForMigration.length === 0
        ? []
        : readJj({ args: ['diff', '--from', baseForMigration, '--to', commit, '--name-only'], cwd })
            .split('\n')
            .filter(Boolean)
    // A path that already exists in the base would have its content changed by the
    // leaf, which is how an outdated copy of landed work gets re-introduced.
    const graftExisting = graftPaths.filter(path => basePaths.has(path))
    const graftNew = graftPaths.filter(path => !basePaths.has(path))
    const attribution = attributeGraft(cwd, baseForMigration, commit, graftPaths)
    const liveBelow = Object.entries(heads)
      .filter(([otherName, otherCommit]) => otherName !== name && otherCommit !== commit && ancestors.has(otherCommit))
      .map(([otherName]) => otherName)
    const dirt = resolvedRoot === undefined ? { detected: undefined, count: 0, sample: [] } : dirtySample(resolvedRoot, dirtLimit)
    const ancestorOfSpine = onSpine.has(commit)
    // A revision at or below the spine already has its content on the spine, so
    // the workspace only needs a fresh empty leaf on top of it. A revision above
    // the spine holds unlanded work, so the leaf must copy its whole tree.
    const mode = ancestorOfSpine ? 'reset-to-base' : 'leaf-from-current'
    report.push({
      name,
      commit,
      changeId: readJj({ args: ['log', '-r', commit, '--no-graph', '-T', 'change_id'], cwd }).trim(),
      workspaceRoot: resolvedRoot ?? null,
      empty,
      conflict,
      relation: ancestorOfSpine ? 'on-or-below-spine' : aboveSpine.includes(commit) ? 'above-spine' : 'off-spine',
      isSpine: commit === spineCommit,
      ancestorOfSpine,
      descendantCount: descendants.length,
      foreignDescendantHeads: foreignDescendantNames,
      hasOwnCommitAbove: changedPaths.length > 0,
      changedPaths: changedPaths.slice(0, 20),
      changedPathCount: changedPaths.length,
      graftPaths: graftPaths.slice(0, 20),
      graftPathCount: graftPaths.length,
      graftExistingPaths: graftExisting.slice(0, 20),
      graftAttribution: attribution,
      graftExistingCount: graftExisting.length,
      graftNewCount: graftNew.length,
      liveWorkspacesBelow: liveBelow,
      dirt,
      proposedMode: mode,
      blockers: [
        // Snapshotting a `@` that holds unlanded work rewrites it and rebases its
        // descendants, so live foreign working copies above it must move first.
        mode === 'leaf-from-current' && foreignDescendants.length > 0
          ? `has ${foreignDescendants.length} live foreign working-copy descendant(s) (${foreignDescendantNames.join(', ')}): migrate those first, because snapshotting this @ rebases them`
          : undefined,
        mode === 'reset-to-base' && dirt.detected === true
          ? `possible unsnapshotted changes in ${dirt.sample.length} file(s): this @ is at or below the spine, so a snapshot would rewrite an ancestor of the spine`
          : undefined,
        conflict ? 'working-copy revision has conflicts' : undefined,
        resolvedRoot === undefined ? 'workspace directory not found next to the repository root' : undefined,
      ].filter(Boolean),
      warnings: [
        // reset-to-base only re-points this workspace; it never rewrites the old
        // @, so live working copies above it do not need to move first.
        mode === 'reset-to-base' && foreignDescendants.length > 0
          ? `${foreignDescendants.length} live working copy(s) sit above this revision, but reset-to-base does not rewrite it, so they do not block it`
          : undefined,
        mode === 'leaf-from-current' && graftExisting.length > 0
          ? `the leaf would CHANGE ${graftExisting.length} path(s) that already exist in the base (${graftExisting.slice(0, 4).join(', ')}): if those are outdated copies of landed work, use --mode reset-to-base instead`
          : undefined,
        mode === 'leaf-from-current' && graftNew.length > 0
          ? `the leaf would ADD ${graftNew.length} new path(s) vs the base (${graftNew.slice(0, 4).join(', ')})${liveBelow.length > 0 ? `, which also sit above ${liveBelow.join(', ')}` : ''}: confirm they are this workspace's own work`
          : undefined,
      ].filter(Boolean),
    })
  }

  const gate = readMaintenance(cwd)
  const operations = recentOperation(cwd, quietSeconds)
  const processLines = jjProcessLines()
  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    store,
    workspacePathSource: pathSource,
    spine: { name: spineName, commit: spineCommit || null },
    migrationBase: baseForMigration || null,
    maintenance: gate ?? null,
    safety: {
      quietSeconds,
      recentOperationCount: operations.filter(entry => entry.recent).length,
      newestOperation: operations[0] ?? null,
      runningJjProcesses: processLines,
      mutatingJjProcesses: mutatingJjProcesses(processLines),
      quiet: operations.every(entry => !entry.recent),
    },
    workspaces: report,
    // The tip first: migrating a leaf clears the blocker above the next workspace.
    order: [...report]
      .filter(entry => entry.workspaceRoot !== null && entry.name !== 'default')
      .sort((left, right) => left.descendantCount - right.descendantCount || left.name.localeCompare(right.name))
      .map(entry => entry.name),
  }
}

export const formatPreflight = preflight => {
  const lines = []
  lines.push(`store            ${preflight.store}`)
  lines.push(`workspace paths  from ${preflight.workspacePathSource}`)
  lines.push(`spine            ${preflight.spine.name} ${(preflight.spine.commit ?? 'UNRESOLVED').slice(0, 12)}`)
  lines.push(`migration base   ${(preflight.migrationBase ?? 'UNRESOLVED').slice(0, 12)}`)
  lines.push(`maintenance      ${preflight.maintenance === null ? 'disarmed' : preflight.maintenance.expired ? 'EXPIRED' : `ARMED by ${preflight.maintenance.armedBy ?? '?'}`}`)
  lines.push(
    `quiet gate       ${preflight.safety.quiet ? 'quiet' : `NOT QUIET (${preflight.safety.recentOperationCount} recent op(s))`}; newest op ${preflight.safety.newestOperation?.ageSeconds ?? '?'}s ago`,
  )
  lines.push(`live jj procs    ${preflight.safety.runningJjProcesses.length}`)
  for (const process of preflight.safety.runningJjProcesses) lines.push(`  ${process}`)
  lines.push('')
  for (const entry of preflight.workspaces) {
    lines.push(`${entry.name}  ${entry.commit.slice(0, 12)}  ${entry.relation}  mode=${entry.proposedMode}`)
    lines.push(`  flags       empty=${entry.empty} conflict=${entry.conflict} is-spine=${entry.isSpine}`)
    lines.push(`  descendants ${entry.descendantCount}${entry.foreignDescendantHeads.length > 0 ? ` (live foreign heads: ${entry.foreignDescendantHeads.join(', ')})` : ''}`)
    lines.push(`  own change  ${entry.changedPathCount} path(s)${entry.changedPaths.length > 0 ? `: ${entry.changedPaths.slice(0, 6).join(', ')}` : ''}`)
    lines.push(
      `  leaf graft  ${entry.graftPathCount} path(s) vs base (${entry.graftNewCount} new, ${entry.graftExistingCount} would change)` +
        `${entry.graftPaths.length > 0 ? `: ${entry.graftPaths.slice(0, 6).join(', ')}` : ''}`,
    )
    for (const path of entry.graftPaths.slice(0, 4)) {
      const owners = entry.graftAttribution[path]
      if (owners !== undefined) lines.push(`    ${path}  <- ${owners.join(' | ')}`)
    }
    lines.push(`  dirt        ${entry.dirt.detected === undefined ? 'unknown (no .jj/working_copy)' : entry.dirt.detected ? `DETECTED in ${entry.dirt.sample.length} file(s): ${entry.dirt.sample.slice(0, 4).join(', ')}` : 'not detected (not proof of clean)'}`)
    if (entry.blockers.length > 0) lines.push(`  blockers    ${entry.blockers.join(' | ')}`)
    if (entry.warnings.length > 0) lines.push(`  warnings    ${entry.warnings.join(' | ')}`)
  }
  lines.push('')
  lines.push(`proposed migration order (highest @ first): ${preflight.order.join(' -> ')}`)
  return lines.join('\n')
}
