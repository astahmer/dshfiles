import { spawnSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Page } from 'playwright'
import type { ReachSeed } from '../project/features.js'
import { DSHFILES_ROOT } from '../project/local-bundles.js'
import { ScratchError, type ScratchState } from './state.js'

const NEW_THREAD_COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const LANDABLE_THREAD_MESSAGE = 'Seeded thread to land'
const PENDING_RESTART_MARKER = '\n// dshx dev seed: pending restart\n'
/** thread-sidebar reports pending Host updates, so its own Host entry is the one a seeded rebuild changes. */
const PENDING_RESTART_PLUGIN = '@dshfiles/thread-sidebar'

const runJj = (input: { readonly cwd: string; readonly home: string; readonly args: readonly string[]; readonly purpose: string }): void => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...input.args], {
    cwd: input.cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: input.home,
      XDG_CONFIG_HOME: join(input.home, 'config'),
      JJ_USER: 'Scratch DSH',
      JJ_EMAIL: 'scratch-dsh@example.invalid',
    },
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.error !== undefined || result.status !== 0) {
    throw new ScratchError(
      'project-seed-failed',
      `jj ${input.args[0] ?? ''} failed while ${input.purpose}: ${result.stderr ?? result.error?.message ?? ''}`,
      'Install jj, or pass --project <dir> to register an existing folder.',
    )
  }
}

/** A jj repository with a `main` bookmark, so jj-integration's destination bar has a bookmark and isolation to show. */
export const seedSampleProject = async (home: string): Promise<string> => {
  const project = join(home, 'projects', 'sample')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'README.md'), '# Sample\n\nScratch project created by dshx dev up.\n')
  for (const args of [
    ['git', 'init', '--no-colocate'],
    ['describe', '--message', 'Sample project'],
    ['bookmark', 'create', 'main', '--revision', '@'],
    ['new'],
  ]) {
    runJj({ cwd: project, home, args, purpose: 'seeding the sample project' })
  }
  return project
}

/**
 * Start a thread in its own jj workspace through the New thread screen, then stand in for the agent's edit with a
 * described revision in that workspace, so Land has work to land.
 */
const seedLandableThread = async (state: ScratchState, page: Page, timeoutMs: number): Promise<void> => {
  if (!state.bundles.includes('@dshfiles/jj-integration')) {
    throw new ScratchError(
      'seed-needs-plugin',
      'Seed landable-thread needs @dshfiles/jj-integration.',
      'Run "dshx dev down" then "dshx dev up --plugin @dshfiles/jj-integration ...".',
    )
  }
  const composer = page.getByRole('textbox', { name: NEW_THREAD_COMPOSER, exact: true })
  if (!(await composer.isVisible())) await page.getByRole('button', { name: 'New thread', exact: true }).first().click({ timeout: timeoutMs })
  await composer.waitFor({ state: 'visible', timeout: timeoutMs })
  const projectName = basename(state.project.path)
  const projectButton = page.getByRole('button', { name: 'Choose workspace', exact: true })
  if ((await projectButton.textContent())?.trim() !== projectName) {
    await projectButton.click({ timeout: timeoutMs })
    await page.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true }).fill(projectName, { timeout: timeoutMs })
    await page.getByRole('option', { name: projectName }).first().waitFor({ state: 'visible', timeout: timeoutMs })
    await page.keyboard.press('Enter')
  }
  const workspaceToggle = page.getByRole('checkbox', { name: 'workspace', exact: true })
  if ((await workspaceToggle.getAttribute('aria-checked', { timeout: timeoutMs })) !== 'true') await workspaceToggle.click({ timeout: timeoutMs })
  const threadLabel = new RegExp(`^${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · (thread-[\\w-]+)$`)
  const deadline = Date.now() + timeoutMs
  let threadName: string | undefined
  while (threadName === undefined && Date.now() < deadline) {
    threadName = threadLabel.exec((await projectButton.textContent())?.trim() ?? '')?.[1]
    if (threadName === undefined) await page.waitForTimeout(250)
  }
  if (threadName === undefined) {
    throw new ScratchError(
      'seed-failed',
      'The workspace toggle did not provision a thread workspace.',
      'Run "dshx dev open jj-integration/thread-destination".',
    )
  }
  await composer.fill(LANDABLE_THREAD_MESSAGE)
  await composer.press('Enter')
  await page
    .getByRole('navigation', { name: 'Session hierarchy', exact: true })
    .filter({ hasText: LANDABLE_THREAD_MESSAGE })
    .waitFor({ state: 'visible', timeout: timeoutMs })
  const threadPath = join(dirname(state.project.path), `${projectName}-threads`, threadName)
  if (
    !(await stat(threadPath).then(
      info => info.isDirectory(),
      () => false,
    ))
  ) {
    throw new ScratchError('seed-failed', `The thread workspace ${threadPath} does not exist.`, 'Check jj-integration threadsDirectory in the scratch profile.')
  }
  await writeFile(join(threadPath, 'seeded-work.md'), 'Work a scratch thread is ready to land.\n')
  runJj({ cwd: threadPath, home: state.home, args: ['describe', '--message', 'Seeded work to land'], purpose: 'describing the seeded thread work' })
}

/** The scratch profile links owned bundles, so this changes the checkout's build output until `down` restores it. */
const seedPendingRestart = async (state: ScratchState): Promise<string> => {
  if (!state.bundles.includes(PENDING_RESTART_PLUGIN)) {
    throw new ScratchError(
      'seed-needs-plugin',
      `Seed pending-restart needs ${PENDING_RESTART_PLUGIN}.`,
      `Run "dshx dev down" then "dshx dev up --plugin ${PENDING_RESTART_PLUGIN} ...".`,
    )
  }
  const hostEntry = join(DSHFILES_ROOT, 'plugins', PENDING_RESTART_PLUGIN, 'dist', 'index.js')
  const source = await readFile(hostEntry, 'utf8')
  if (!source.endsWith(PENDING_RESTART_MARKER)) await writeFile(hostEntry, `${source}${PENDING_RESTART_MARKER}`)
  return hostEntry
}

/** Undo `seed pending-restart`: the restored file, or undefined when it no longer carries the seed. */
export const restorePendingRestart = async (state: ScratchState, dryRun: boolean): Promise<string | undefined> => {
  const hostEntry = state.seeds?.find(applied => applied.seed === 'pending-restart')?.changedFile
  if (hostEntry === undefined) return undefined
  const source = await readFile(hostEntry, 'utf8').catch(() => '')
  if (!source.endsWith(PENDING_RESTART_MARKER)) return undefined
  if (!dryRun) await writeFile(hostEntry, source.slice(0, -PENDING_RESTART_MARKER.length))
  return hostEntry
}

/** Apply one seed; returns the checkout file it changed, if any. */
export const applySeed = async (input: {
  readonly state: ScratchState
  readonly seed: ReachSeed
  readonly page: Page
  readonly timeoutMs: number
}): Promise<string | undefined> => {
  if (input.seed === 'pending-restart') return seedPendingRestart(input.state)
  await seedLandableThread(input.state, input.page, input.timeoutMs)
  return undefined
}
