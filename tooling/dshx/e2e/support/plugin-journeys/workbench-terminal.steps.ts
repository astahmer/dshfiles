import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { After, Then, When } from '../bdd.js'
import { recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

const regions = ['main', 'right', 'left', 'bottom'] as const
type Region = (typeof regions)[number]
interface TerminalIdentity {
  readonly resourceId: string
  readonly sessionId: string
  readonly occurrenceId: string
  readonly pid: number
}
interface TerminalJourney {
  readonly root: string
  readonly workspace: string
  readonly sessionId: string
  readonly terminals: Map<Region, TerminalIdentity>
  bindings?: readonly (readonly [string, string | null])[]
}
const journeys = new WeakMap<Page, TerminalJourney>()
const journey = (page: Page): TerminalJourney => {
  const value = journeys.get(page)
  if (value === undefined) throw new Error('Terminal workspace setup is missing')
  return value
}
const pane = (page: Page, region: Region): Locator => page.locator(`[data-workbench-region="${region}"]`).first()
const terminalBody = (page: Page, id: string): Locator => page.locator(`[data-sidebar-resource-panel=${JSON.stringify(id)}]`)
const terminalTab = (page: Page, id: string): Locator => page.getByRole('tab').filter({ has: page.locator(`[data-workbench-tab-id=${JSON.stringify(id)}]`) })
const output = (body: Locator): Locator => body.locator('.xterm-rows')
const visibleTerminals = (scope: Locator): Locator =>
  scope.locator('[data-sidebar-resource-panel]').filter({ has: scope.page().locator('[data-sidebar-terminal]'), visible: true })
const bindingSnapshot = (page: Page): Promise<readonly (readonly [string, string | null])[]> =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter(key => key.startsWith('dsh.terminal.binding.v1.'))
      .sort()
      .map(key => [key, localStorage.getItem(key)] as const),
  )
const options = async (page: Page, scope: Locator, name: string): Promise<void> => {
  await scope.getByRole('button', { name: 'Pane options', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
const probeShell = async (page: Page, identity: Pick<TerminalIdentity, 'resourceId'>, label: Region): Promise<number> => {
  const body = terminalBody(page, identity.resourceId)
  await expect(body).toBeVisible()
  await expect(body.locator('[data-sidebar-terminal]')).toHaveCount(1)
  await expect(body.getByRole('status')).toHaveCount(0)
  const input = body.locator('.xterm-helper-textarea')
  await expect(input).toHaveCount(1)
  // The echoed command contains %s, not the numeric marker asserted below.
  // Only a real shell's printf expansion can produce the expected output.
  await input.pressSequentially(`printf 'WB_${label}_%s\\n' "$$"; pwd`)
  await input.press('Enter')
  const marker = new RegExp(`WB_${label}_(\\d+)`)
  await expect(output(body)).toContainText(marker)
  await expect(output(body)).toContainText(journey(page).workspace)
  const text = (await output(body).textContent()) ?? ''
  const matches = [...text.matchAll(new RegExp(marker, 'g'))]
  const pid = Number(matches.at(-1)?.[1])
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Native terminal did not report a genuine shell PID')
  return pid
}
const capture = async (page: Page, body: Locator, label: Region): Promise<TerminalIdentity> => {
  const resourceId = await body.getAttribute('data-sidebar-resource-panel')
  const sessionId = await body.getAttribute('data-sidebar-right-session')
  const occurrenceId = await body.getAttribute('data-sidebar-right-occurrence')
  if (resourceId === null || sessionId === null || occurrenceId === null) throw new Error('Native terminal occurrence identity is missing')
  expect(sessionId).toBe(journey(page).sessionId)
  return { resourceId, sessionId, occurrenceId, pid: await probeShell(page, { resourceId }, label) }
}
const shellIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

When('a disposable terminal workspace has a selected real conversation', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-workbench-terminal-')
  const workspace = join(root, 'terminal-project')
  await mkdir(workspace)
  await pane(page, 'left').getByRole('button', { name: 'New thread', exact: true }).filter({ visible: true }).click()
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true }).fill(workspace)
  await picker.getByRole('button', { name: 'Register project', exact: true }).first().click()
  await expect(picker).toBeHidden()
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).not.toBeNull()
  const sessionId = new URL(page.url()).searchParams.get('thread')
  if (sessionId === null) throw new Error('The actual terminal Session was not created')
  const composer = pane(page, 'main')
    .locator(`[data-conversation-session=${JSON.stringify(sessionId)}]`)
    .getByRole('textbox', {
      name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/,
    })
  await expect(composer).toBeEditable()
  journeys.set(page, { root, workspace, sessionId, terminals: new Map() })
})

When('the {string} pane opens a genuine terminal from its view picker', async ({ page }: { page: Page }, regionName: string) => {
  const region = regions.find(value => value === regionName)
  if (region === undefined) throw new Error(`Unknown terminal destination ${regionName}`)
  const target = pane(page, region)
  const existing = journey(page).terminals.size
  const plus = target.getByRole('button', { name: 'New tab', exact: true }).filter({ visible: true })
  // The left footer Preview is also a regular group now. Select the actual
  // full-height Threads group, not a positional last button in compact chrome.
  const leftThreads = target
    .getByRole('tab', { name: 'Thread Sidebar: Threads', exact: true })
    .locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," dv-groupview ")][1]')
  await (region === 'left' ? leftThreads.getByRole('button', { name: 'New tab', exact: true }) : plus.first()).click()
  const chooser = target.getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
  await expect(chooser).toHaveCount(1)
  await chooser.getByRole('button', { name: 'Terminal: Terminal', exact: true }).click()
  await expect(chooser).toBeHidden()
  const body = visibleTerminals(target)
  await expect(body).toHaveCount(1)
  const identity = await capture(page, body, region)
  journey(page).terminals.set(region, identity)
  await expect(page.locator('[data-sidebar-terminal]')).toHaveCount(existing + 1)
  await recordAssertion(page, `terminal-picker-${region}-genuine-shell`, async () => {
    expect(shellIsAlive(identity.pid)).toBe(true)
    await expect(terminalTab(page, identity.resourceId)).toHaveCount(1)
  })
})

Then('the main terminal did not reveal the right pane', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'terminal-main-no-right-reveal', async () => {
    await expect(pane(page, 'right')).toBeHidden()
    await expect(pane(page, 'main').locator('[data-sidebar-terminal]')).toHaveCount(1)
  })
})

When('the other terminal destination panes are revealed', async ({ page }: { page: Page }) => {
  await options(page, pane(page, 'main'), 'Open right pane')
  await options(page, pane(page, 'main'), 'Toggle the bottom panel')
  for (const region of regions) await expect(pane(page, region)).toBeVisible()
})

Then('the four terminal views have independent native shells and buffers', async ({ page }: { page: Page }) => {
  const state = journey(page)
  await recordAssertion(page, 'terminal-four-independent-native-shells', async () => {
    expect(new Set([...state.terminals.values()].map(value => value.resourceId)).size).toBe(4)
    expect(new Set([...state.terminals.values()].map(value => value.pid)).size).toBe(4)
    for (const [label, identity] of state.terminals) {
      for (const other of regions.filter(region => region !== label))
        await expect(output(terminalBody(page, identity.resourceId))).not.toContainText(`WB_${other}_`)
    }
    state.bindings = await bindingSnapshot(page)
    expect(state.bindings).toHaveLength(4)
    await page.screenshot({ path: test.info().outputPath('workbench-terminal-every-pane.png'), animations: 'disabled' })
  })
})

When('the first terminal moves through every Workbench pane', async ({ page }: { page: Page }) => {
  const identity = journey(page).terminals.get('main')
  if (identity === undefined) throw new Error('Main terminal is missing')
  const labels = { right: 'Move to the dock', left: 'Move to the left pane', bottom: 'Move to the bottom panel', main: 'Move to main view' }
  for (const destination of ['right', 'left', 'bottom', 'main'] as const) {
    const tab = terminalTab(page, identity.resourceId)
    await tab.click()
    const group = tab.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," dv-groupview ")][1]')
    await group.getByRole('button', { name: 'Pane options', exact: true }).click()
    const move = page.getByRole('menuitem', { name: 'Move tab to', exact: true })
    await move.hover()
    await move.press('ArrowRight')
    await page.getByRole('menuitem', { name: labels[destination], exact: true }).click()
    const moved = pane(page, destination).locator(`[data-sidebar-resource-panel=${JSON.stringify(identity.resourceId)}]`)
    await expect(moved).toBeVisible()
    await expect(moved).toHaveAttribute('data-sidebar-right-occurrence', identity.occurrenceId)
    expect(await probeShell(page, identity, 'main')).toBe(identity.pid)
    await expect(terminalTab(page, identity.resourceId)).toHaveCount(1)
    expect(await bindingSnapshot(page)).toEqual(journey(page).bindings)
  }
  await recordAssertion(page, 'terminal-moves-retain-native-id-and-pid', async () => {
    expect(shellIsAlive(identity.pid)).toBe(true)
    await expect(page.locator('[data-sidebar-terminal]')).toHaveCount(4)
  })
})

Then('the same terminal identities and shell processes recover without new allocation', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'terminal-reload-retains-allocations', async () => {
    const state = journey(page)
    for (const [label, identity] of state.terminals) {
      await terminalTab(page, identity.resourceId).click()
      const body = terminalBody(page, identity.resourceId)
      await expect(body).toHaveAttribute('data-sidebar-right-session', identity.sessionId)
      expect(await probeShell(page, identity, label)).toBe(identity.pid)
    }
    expect(await bindingSnapshot(page)).toEqual(state.bindings)
    await expect(page.locator('[data-sidebar-terminal]')).toHaveCount(4)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('every terminal tab is explicitly closed', async ({ page }: { page: Page }) => {
  for (const identity of journey(page).terminals.values()) {
    const tab = terminalTab(page, identity.resourceId)
    await tab.getByRole('button', { name: /^Close / }).click()
    await expect(tab).toHaveCount(0)
    await expect(terminalBody(page, identity.resourceId)).toHaveCount(0)
    await expect.poll(() => shellIsAlive(identity.pid)).toBe(false)
  }
})

Then('the native terminal owner has removed its records and stopped those shells', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'terminal-native-close-releases-shells', async () => {
    await expect(page.locator('[data-sidebar-terminal]')).toHaveCount(0)
    expect(await bindingSnapshot(page)).toEqual([])
    for (const identity of journey(page).terminals.values()) expect(shellIsAlive(identity.pid)).toBe(false)
  })
})

After(async ({ page }: { page: Page }) => {
  const state = journeys.get(page)
  if (state === undefined) return
  journeys.delete(page)
  // Delete only the absolute scratch directory this scenario actually created.
  if (dirname(state.root) !== tmpdir() || !basename(state.root).startsWith('dshx-workbench-terminal-'))
    throw new Error('Unexpected terminal scratch cleanup target')
  await rm(state.root, { recursive: true, force: true })
})
