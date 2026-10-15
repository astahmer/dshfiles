import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { CheckoutSyncError, planRebuild, runCommand, runRebuild, type PluginEffect } from './rebuild.js'

export interface SyncRevision {
  readonly changeId: string
  readonly description: string
}

export type CheckoutSyncStatus = 'up-to-date' | 'synced' | 'would-sync' | 'refused' | 'conflicted' | 'build-failed'

export interface CheckoutSyncResult {
  readonly workspace: string
  readonly path: string
  readonly bookmark: string
  readonly dryRun: boolean
  readonly status: CheckoutSyncStatus
  /** The main the checkout was built on, and the main it moved to. */
  readonly from: string | null
  readonly to: string
  readonly updatedStale: boolean
  /** Undescribed (local) revisions carried onto main. */
  readonly kept: readonly SyncRevision[]
  /** Described revisions whose changes main already holds; the rebase dropped them. */
  readonly absorbed: readonly SyncRevision[]
  /** Described revisions main does not hold yet; the sync refuses to move them. */
  readonly unlanded: readonly SyncRevision[]
  readonly conflicts: readonly string[]
  readonly changedFiles: readonly string[]
  readonly installs: readonly string[]
  readonly rebuilt: { readonly dshx: boolean; readonly plugins: readonly string[] }
  readonly plugins: readonly PluginEffect[]
  readonly restart: { readonly needed: boolean; readonly reasons: readonly string[] }
  readonly hint: string | null
  readonly failure: { readonly step: string; readonly command: string; readonly output: string } | null
}

interface Revision {
  readonly changeId: string
  readonly commitId: string
  readonly conflict: boolean
  readonly empty: boolean
  readonly description: string
}

const PLACEHOLDER_DESCRIPTIONS = new Set(['', 'wip'])
const MAX_LISTED_FILES = 200
const REVISION_TEMPLATE = 'change_id.short(12) ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ empty ++ "\\t" ++ description.first_line() ++ "\\n"'

const isPlaceholder = (revision: Revision): boolean => PLACEHOLDER_DESCRIPTIONS.has(revision.description.trim().toLowerCase())
const shown = (revision: Revision): SyncRevision => ({ changeId: revision.changeId, description: revision.description })

const jjAt = (cwd: string) => {
  const run = (args: readonly string[]) => runCommand({ argv: ['jj', '--color=never', '--no-pager', ...args], cwd })
  const read = async (args: readonly string[]): Promise<string> => {
    const result = await runCommand({ argv: ['jj', '--color=never', '--no-pager', ...args], cwd })
    if (result.exitCode !== 0)
      throw new CheckoutSyncError(
        'jj-failed',
        `jj ${args.join(' ')} failed in ${cwd}: ${result.output.trim().slice(-600)}`,
        `Run "jj ${args.join(' ')}" in ${cwd} to see why.`,
      )
    return result.output
  }
  const revisions = async (revset: string): Promise<readonly Revision[]> =>
    (await read(['--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', REVISION_TEMPLATE]))
      .split('\n')
      .filter(line => line.includes('\t'))
      .map(line => {
        const [changeId = '', commitId = '', conflict = '', empty = '', ...description] = line.split('\t')
        return { changeId, commitId, conflict: conflict === 'true', empty: empty === 'true', description: description.join('\t').trim() }
      })
  const operation = async (): Promise<string> => (await read(['--ignore-working-copy', 'op', 'log', '-n', '1', '--no-graph', '-T', 'id'])).trim()
  return { run, read, revisions, operation }
}

/** jj refuses to touch a working copy another workspace rewrote until `update-stale` checks it out again. */
const updateIfStale = async (jj: ReturnType<typeof jjAt>): Promise<boolean> => {
  const status = await jj.run(['status'])
  if (status.exitCode === 0) return false
  if (!/stale/i.test(status.output))
    throw new CheckoutSyncError(
      'jj-failed',
      `jj status failed: ${status.output.trim().slice(-600)}`,
      'Fix the checkout until "jj status" succeeds there, then sync again.',
    )
  await jj.read(['workspace', 'update-stale'])
  return true
}

const realPath = (path: string): string => (existsSync(path) ? realpathSync(path) : path)

const restartReasons = (plugins: readonly PluginEffect[], profileReason: string | null): readonly string[] => [
  ...plugins.filter(plugin => plugin.host).map(plugin => `${plugin.name} Host bundle changed`),
  ...(profileReason === null ? [] : [profileReason]),
]

/**
 * Reconciles the live web profile from the checkout's seed with the checkout's own `scripts/profile-sync.ts`, the
 * reconciler the `dsh web` supervisor also runs before each start. It skips when `DSHFILES_DIR` names another checkout,
 * so the profile never flips between two checkouts.
 */
const syncWebProfile = async (input: {
  readonly root: string
  readonly onProgress?: ((message: string) => void) | undefined
  readonly onOutput?: ((chunk: string) => void) | undefined
}): Promise<string> => {
  const running = process.env.DSHFILES_DIR?.trim()
  if (running !== undefined && running.length > 0 && realPath(running) !== realPath(input.root))
    return `the profile seed changed here, but DSH runs from ${running}; its next start syncs from there`
  input.onProgress?.('sync the web profile: node scripts/profile-sync.ts --profile web')
  const result = await runCommand({
    argv: [process.execPath, join(input.root, 'scripts/profile-sync.ts'), '--profile', 'web'],
    cwd: input.root,
    onOutput: input.onOutput,
  })
  if (result.exitCode === 0) return 'the web profile was synced from the changed seed: restart to apply'
  const reason = result.output.trim().split('\n').at(-1) ?? `exit ${String(result.exitCode)}`
  return `the profile seed changed but syncing the web profile failed (${reason}); the next "dsh web" start retries it`
}

/**
 * Brings the checkout of one jj workspace (the one running `dsh web`, `default` by default) onto the target bookmark,
 * keeping its local edits, then reinstalls and rebuilds what the move changed.
 *
 * Only undescribed (`wip`) revisions and described revisions main already holds move; described work main lacks is
 * refused, a conflict is undone, and a rebase that would rewrite another workspace's working copy is refused. Every
 * jj step runs in the workspace's own directory, so its files follow the rebase.
 */
export const syncCheckout = async (options: {
  readonly cwd: string
  readonly workspace: string
  readonly bookmark: string
  readonly dryRun: boolean
  readonly onProgress?: ((message: string) => void) | undefined
  readonly onOutput?: ((chunk: string) => void) | undefined
}): Promise<CheckoutSyncResult> => {
  const { workspace, bookmark, dryRun } = options
  const located = await runCommand({
    argv: ['jj', '--color=never', '--no-pager', '--ignore-working-copy', 'workspace', 'root', '--name', workspace],
    cwd: options.cwd,
  })
  if (located.exitCode !== 0) {
    const inRepository = (await runCommand({ argv: ['jj', '--ignore-working-copy', 'root'], cwd: options.cwd })).exitCode === 0
    throw inRepository
      ? new CheckoutSyncError(
          'no-workspace',
          `This repository has no jj workspace named "${workspace}".`,
          `List them with "jj workspace list", then pass --workspace <name>.`,
        )
      : new CheckoutSyncError('not-a-repository', `${options.cwd} is not inside a jj repository.`, 'Run from inside the repository or pass --cwd <directory>.')
  }
  const path = located.output.trim()
  const jj = jjAt(path)
  const target = (await jj.revisions(`present(${bookmark})`))[0]
  if (target === undefined)
    throw new CheckoutSyncError('no-bookmark', `The bookmark "${bookmark}" does not exist.`, 'Pass --bookmark <name> with an existing local bookmark.')

  const base: Omit<CheckoutSyncResult, 'status'> = {
    workspace,
    path,
    bookmark,
    dryRun,
    from: null,
    to: target.commitId,
    updatedStale: false,
    kept: [],
    absorbed: [],
    unlanded: [],
    conflicts: [],
    changedFiles: [],
    installs: [],
    rebuilt: { dshx: false, plugins: [] },
    plugins: [],
    restart: { needed: false, reasons: [] },
    hint: null,
    failure: null,
  }
  // Dry runs leave the files alone; the real run snapshots the local edits first so they ride the rebase.
  const updatedStale = dryRun ? false : await updateIfStale(jj)
  const alreadyOnBookmark = (await jj.revisions(`${bookmark} & ::@`)).length > 0
  if (alreadyOnBookmark) {
    const plan = planRebuild({ root: path, changedFiles: [] })
    if (!plan.dshx && plan.plugins.length === 0) return { ...base, updatedStale, status: 'up-to-date' }
    const synced = { ...base, updatedStale }
    if (dryRun) {
      const reasons = restartReasons(plan.plugins, null)
      return {
        ...synced,
        status: 'would-sync',
        installs: plan.installRoots,
        rebuilt: { dshx: plan.dshx, plugins: plan.plugins.map(plugin => plugin.name) },
        plugins: plan.plugins,
        restart: { needed: reasons.length > 0, reasons },
      }
    }
    const outcome = await runRebuild({ root: path, plan, changedFiles: [], onProgress: options.onProgress, onOutput: options.onOutput })
    const reasons = restartReasons(outcome.plugins, null)
    return {
      ...synced,
      status: outcome.failure === null ? 'synced' : 'build-failed',
      installs: outcome.installed,
      rebuilt: { dshx: outcome.dshx, plugins: outcome.plugins.map(plugin => plugin.name) },
      plugins: outcome.plugins,
      restart: { needed: reasons.length > 0, reasons },
      hint:
        outcome.failure === null
          ? null
          : `${workspace} is already on ${bookmark}, but "${outcome.failure.step}" failed. Fix it and rerun ${outcome.failure.command}.`,
      failure: outcome.failure,
    }
  }

  const from = (await jj.revisions(`latest(heads(::@ & ::${bookmark}))`))[0]?.commitId ?? null
  const stack = await jj.revisions(`::@ ~ ::${bookmark}`)
  const lone = stack.length === 1 && (await jj.revisions('@:: ~ @')).length === 0
  if (!lone) {
    const others = (
      await jj.read([
        '--ignore-working-copy',
        'log',
        '--no-graph',
        '-r',
        `(roots(::@ ~ ::${bookmark})::) & working_copies() ~ @`,
        '-T',
        'working_copies.map(|w| w.name()).join(",") ++ "\\n"',
      ])
    )
      .split(/[\n,]/)
      .filter(name => name.length > 0)
    if (others.length > 0)
      return {
        ...base,
        from,
        updatedStale,
        status: 'refused',
        hint: `Rebasing ${workspace}'s revisions would rewrite the working copy of ${others.join(', ')}, which builds on them. Rebase or move that work first, then sync again.`,
      }
  }

  const preOperation = await jj.operation()
  const preWorkingCopy = (await jj.revisions('@'))[0]?.commitId
  const quiet = dryRun ? ['--ignore-working-copy'] : []
  options.onProgress?.(`rebase ${workspace} onto ${bookmark}${dryRun ? ' (simulated)' : ''}`)
  await jj.read([...quiet, 'rebase', lone ? '-r' : '-b', '@', '-d', bookmark, '--skip-emptied'])
  const rebaseOperation = await jj.operation()
  const after = await jj.revisions(`::@ ~ ::${bookmark}`)

  // Restore exactly when nothing else wrote since the rebase; otherwise revert only the rebase, so a concurrent
  // Rebase or agent operation is not undone with it.
  const undo = async (): Promise<void> => {
    const head = await jj.operation()
    await jj.read(head === rebaseOperation ? [...quiet, 'op', 'restore', preOperation] : [...quiet, 'op', 'revert', rebaseOperation])
    const restored = (await jj.revisions('@'))[0]?.commitId
    if (restored !== preWorkingCopy)
      throw new CheckoutSyncError(
        'restore-failed',
        `Undoing the sync left ${workspace}@ at ${restored ?? 'nothing'} instead of ${preWorkingCopy ?? 'its previous commit'}.`,
        `Inspect "jj op log" in ${path} and run "jj op restore ${preOperation}" there if nothing else changed since.`,
      )
  }

  const stackIds = new Set(after.map(revision => revision.changeId))
  const absorbed = stack.filter(revision => !revision.empty && !isPlaceholder(revision) && !stackIds.has(revision.changeId)).map(shown)
  const kept = after.filter(revision => !revision.empty).map(shown)
  const unlanded = after.filter(revision => !revision.empty && !isPlaceholder(revision)).map(shown)
  if (unlanded.length > 0) {
    await undo()
    return {
      ...base,
      from,
      updatedStale,
      status: 'refused',
      unlanded,
      hint: `${workspace}@ carries described work ${bookmark} does not have yet. Rebase it onto ${bookmark} (or describe it "wip" if it is local-only), then sync again.`,
    }
  }
  const conflicted = after.filter(revision => revision.conflict)
  if (conflicted.length > 0) {
    const files = new Set<string>()
    for (const revision of conflicted) {
      const listed = await jj.run(['--ignore-working-copy', 'resolve', '--list', '-r', revision.commitId])
      for (const line of listed.output.split('\n')) {
        const file = line.trim().split(/\s{2,}/)[0]
        if (file !== undefined && file.length > 0) files.add(file)
      }
    }
    await undo()
    return {
      ...base,
      from,
      updatedStale,
      status: 'conflicted',
      conflicts: [...files].slice(0, MAX_LISTED_FILES),
      hint: `Nothing changed. Resolve by hand in ${path}: "jj rebase ${lone ? '-r' : '-b'} @ -d ${bookmark}", fix the listed files, or move those local edits aside first.`,
    }
  }

  const changedFiles = (await jj.read(['--ignore-working-copy', 'diff', '--from', from ?? 'root()', '--to', target.commitId, '--name-only']))
    .split('\n')
    .filter(line => line.length > 0)
  const plan = planRebuild({ root: path, changedFiles })
  const synced = { ...base, from, updatedStale, kept, absorbed, changedFiles: changedFiles.slice(0, MAX_LISTED_FILES) }
  if (dryRun) {
    await undo()
    const reasons = restartReasons(
      plan.plugins,
      plan.profileChanged ? 'the profile seed changed: the sync would reconcile the web profile; restart to apply' : null,
    )
    return {
      ...synced,
      status: 'would-sync',
      installs: plan.installRoots,
      rebuilt: { dshx: plan.dshx, plugins: plan.plugins.map(plugin => plugin.name) },
      plugins: plan.plugins,
      restart: { needed: reasons.length > 0, reasons },
    }
  }

  await updateIfStale(jj)
  const outcome = await runRebuild({
    root: path,
    plan,
    changedFiles,
    onProgress: options.onProgress,
    onOutput: options.onOutput,
  })
  const profileReason = !plan.profileChanged
    ? null
    : outcome.failure === null
      ? await syncWebProfile({ root: path, onProgress: options.onProgress, onOutput: options.onOutput })
      : 'the profile seed changed: the next "dsh web" start syncs it'
  const reasons = restartReasons(outcome.plugins, profileReason)
  return {
    ...synced,
    status: outcome.failure === null ? 'synced' : 'build-failed',
    installs: outcome.installed,
    rebuilt: { dshx: outcome.dshx, plugins: outcome.plugins.map(plugin => plugin.name) },
    plugins: outcome.plugins,
    restart: { needed: reasons.length > 0, reasons },
    hint:
      outcome.failure === null
        ? null
        : `${workspace} is on ${bookmark}, but "${outcome.failure.step}" failed. Fix it and rerun ${outcome.failure.command}${plan.plugins.length > 0 ? ` and "pnpm --dir plugins ${plan.plugins.map(plugin => `--filter ${plugin.name}`).join(' ')} run build"` : ''}.`,
    failure: outcome.failure,
  }
}
