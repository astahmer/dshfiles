import { spawn } from 'node:child_process'
import { globalPanelLink } from '../plugin-view-names.js'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder } from '../threads.js'

const DECOY_TITLE = 'wtmem-e2e-decoy'

interface Decoy {
  readonly root: string
  readonly workspace: string
  pid: number | null
}

const decoys = new Map<Page, Decoy>()

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const requireDecoy = (page: Page): Decoy => {
  const decoy = decoys.get(page)
  if (decoy === undefined) throw new Error('No decoy was started for this scenario.')
  return decoy
}

const ramEntry = (page: Page) => globalPanelLink(page, 'Worktree Memory: RAM')

When('a detached decoy process runs inside a registered workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-worktree-memory-e2e-')
  const workspace = join(root, 'memory-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  const decoy: Decoy = { root, workspace, pid: null }
  decoys.set(page, decoy)
  // The shell backgrounds the node process and exits, so init adopts the decoy: the shape of a leaked dev server.
  const shell = spawn('/bin/sh', ['-c', `"${process.execPath}" --title=${DECOY_TITLE} -e 'setInterval(() => {}, 1e9)' >/dev/null 2>&1 & echo $!`], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let output = ''
  shell.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  await new Promise<void>(resolve => shell.once('close', () => resolve()))
  decoy.pid = Number(output.trim())
  expect(isAlive(decoy.pid)).toBe(true)
})

When('the RAM panel is opened', async ({ page }: { page: Page }) => {
  await ramEntry(page).click()
  await expect(page.getByRole('heading', { name: 'RAM', exact: true, level: 1 })).toBeVisible()
})

Then('the Node origin summary is visible', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'worktree-memory-node-origins-are-summarized', async () => {
    const summary = page.locator('[data-node-process-summary]')
    await expect(summary).toBeVisible()
    await expect.poll(async () => Number(await summary.getAttribute('data-node-process-count')), { timeout: 30_000 }).toBeGreaterThan(0)
  })
})

Then('the decoy is listed as a detached tree of its workspace', async ({ page }: { page: Page }) => {
  const decoy = requireDecoy(page)
  await recordAssertion(page, 'worktree-memory-lists-the-detached-decoy-under-its-workspace', async () => {
    const group = page.locator(`[data-workspace-group="${decoy.workspace}"]`)
    await expect(group).toBeVisible({ timeout: 30_000 })
    await expect(group).toContainText('1 detached')
    const header = group.locator('button[aria-expanded]').first()
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
    const row = group.locator(`[data-process-pid="${String(decoy.pid)}"]`)
    await expect(row).toContainText(DECOY_TITLE)
    await expect(row).toContainText('Detached')
  })
})

Then('the RAM process list is independently scrollable', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'worktree-memory-process-list-scrolls-within-its-panel', async () => {
    const scrollRegion = page.locator('[data-memory-scroll-region]')
    await expect(scrollRegion).toBeVisible()
    await expect(scrollRegion).toHaveCSS('overflow-y', 'auto')
    await expect(scrollRegion).toHaveCSS('min-height', '0px')
  })
})

Then('the RAM sidebar entry shows the detached memory', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'worktree-memory-sidebar-badge-shows-detached-memory', async () => {
    const badge = ramEntry(page).locator('[data-memory-badge-detached-bytes]')
    await expect.poll(async () => Number(await badge.getAttribute('data-memory-badge-detached-bytes')), { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(badge).toHaveAttribute('data-memory-badge-pressure', /^(normal|warning|critical|unknown)$/)
    await expect(badge).toHaveAttribute('title', /detached/)
  })
})

Then('stopping the decoy from the panel ends the process', async ({ page }: { page: Page }) => {
  const decoy = requireDecoy(page)
  const pid = decoy.pid ?? 0
  await recordAssertion(page, 'worktree-memory-stops-the-detached-decoy', async () => {
    await page.getByRole('button', { name: `Stop ${DECOY_TITLE}`, exact: true }).click()
    await page.getByRole('button', { name: `Confirm stop ${DECOY_TITLE}`, exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Stopped 1/ })).toBeVisible()
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false)
    await expect(page.locator(`[data-process-pid="${String(pid)}"]`)).toHaveCount(0, { timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})

Then('stopping the workspace section from its header ends the process', async ({ page }: { page: Page }) => {
  const decoy = requireDecoy(page)
  const pid = decoy.pid ?? 0
  await recordAssertion(page, 'worktree-memory-stops-a-whole-workspace-section', async () => {
    const group = page.locator(`[data-workspace-group="${decoy.workspace}"]`)
    await expect(group).toBeVisible({ timeout: 30_000 })
    // The section verb sits in the header, so a workspace stop never needs the card expanded first.
    await group.getByRole('button', { name: /^Stop all \(\d+\)/ }).click()
    await group.getByRole('button', { name: /^Confirm stop \(\d+\)/ }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Stopped 1/ })).toBeVisible()
    await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false)
    await expect(page.locator(`[data-process-pid="${String(pid)}"]`)).toHaveCount(0, { timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const decoy = decoys.get(page)
  if (decoy === undefined) return
  decoys.delete(page)
  if (decoy.pid !== null && isAlive(decoy.pid)) process.kill(decoy.pid, 'SIGKILL')
  await rm(decoy.root, { recursive: true, force: true })
})
