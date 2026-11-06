import { readdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { LIVE_DSH_HOME, ScratchStateRuntime, type ScratchState } from './state.js'

const STATE_DIR_MAX_AGE_MS = 24 * 60 * 60_000
const EVIDENCE_KEEP = 20

export interface RetentionAction {
  readonly kind: 'remove-state-dir' | 'remove-scratch-home' | 'prune-evidence'
  readonly target: string
  readonly reason: string
}

const isScratchHome = (home: string): boolean =>
  ScratchStateRuntime.isWithin(tmpdir(), home) && basename(home).startsWith('dshx-boot-profile-') && !ScratchStateRuntime.isWithin(LIVE_DSH_HOME, home)

const newestMtime = async (paths: readonly string[]): Promise<number | undefined> => {
  const times = await Promise.all(paths.map(async path => (await stat(path).catch(() => undefined))?.mtimeMs))
  const known = times.filter(time => time !== undefined)
  return known.length === 0 ? undefined : Math.max(...known)
}

const hasLiveProcess = (state: ScratchState): boolean =>
  [state.host, state.browser, state.watchdog, state.fakeProvider].some(
    owned => owned !== undefined && ScratchStateRuntime.ownedProcessStatus(owned) === 'running',
  )

/**
 * Keep the newest `keep` runs of one evidence directory. A run is every entry sharing a name stem: `dshx dev shot` writes
 * `<time>-<label>.png` beside its `.json` summary.
 */
const pruneEvidence = async (evidenceDir: string, keep: number, dryRun: boolean): Promise<readonly RetentionAction[]> => {
  const names = await readdir(evidenceDir).catch(() => [])
  const runs = new Map<string, { paths: string[]; mtimeMs: number }>()
  for (const name of names) {
    const path = join(evidenceDir, name)
    const mtimeMs = (await stat(path).catch(() => undefined))?.mtimeMs ?? 0
    const stem = name.replace(/\.[^.]+$/, '')
    const run = runs.get(stem) ?? { paths: [], mtimeMs: 0 }
    runs.set(stem, { paths: [...run.paths, path], mtimeMs: Math.max(run.mtimeMs, mtimeMs) })
  }
  const stale = [...runs.values()]
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(keep)
    .flatMap(run => run.paths)
  if (!dryRun) await Promise.all(stale.map(path => rm(path, { recursive: true, force: true })))
  return stale.map(path => ({ kind: 'prune-evidence', target: path, reason: `older than the newest ${String(keep)} evidence runs` }))
}

/**
 * `$TMPDIR/dshx-dev/<name>` retention: cap every instance's evidence to its newest runs, and delete a state directory
 * untouched for `maxAgeMs` whose recorded processes are all gone (with the scratch home it names, if any is left).
 */
export const pruneScratchStateDirs = async (options: {
  readonly dryRun: boolean
  readonly root?: string
  readonly now?: number
  readonly maxAgeMs?: number
  readonly evidenceKeep?: number
}): Promise<readonly RetentionAction[]> => {
  const root = resolve(options.root ?? ScratchStateRuntime.stateRoot())
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? STATE_DIR_MAX_AGE_MS
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const actions: RetentionAction[] = []
  for (const entry of entries.filter(candidate => candidate.isDirectory())) {
    const stateDir = join(root, entry.name)
    const state = await ScratchStateRuntime.read(stateDir, entry.name).catch(() => undefined)
    const evidenceDir = state?.evidenceDir ?? join(stateDir, 'evidence')
    actions.push(...(await pruneEvidence(evidenceDir, options.evidenceKeep ?? EVIDENCE_KEEP, options.dryRun)))
    if (state !== undefined && hasLiveProcess(state)) continue
    const lastTouched = await newestMtime([stateDir, join(stateDir, 'state.json'), evidenceDir])
    if (lastTouched === undefined || now - lastTouched < maxAgeMs) continue
    if (state !== undefined && isScratchHome(state.home)) {
      actions.push({ kind: 'remove-scratch-home', target: state.home, reason: `scratch home of "${state.name}", whose processes are gone` })
      if (!options.dryRun) await rm(state.home, { recursive: true, force: true })
    }
    actions.push({
      kind: 'remove-state-dir',
      target: stateDir,
      reason: `untouched for over ${String(Math.round(maxAgeMs / 3_600_000))} h with no live process`,
    })
    if (!options.dryRun) await rm(stateDir, { recursive: true, force: true })
  }
  return actions
}
