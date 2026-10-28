import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { layoutSchema } from '../../../../../plugins/@dshfiles/workbench/src/layout-store.js'
import { savedLayoutSchema } from '../../../../../plugins/@dshfiles/workbench/src/saved-layouts.js'
import { tabPanelId } from '../../../../../plugins/@dshfiles/workbench/src/tab-panels.js'
import type { PersistedTabs } from '../../../../../plugins/@dshfiles/main-tabs/src/tabs-machine.js'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import { finishJourneyAssertions, profileFor, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

const KEYS = { tabs: 'dshfiles.main-tabs.v1', main: 'dshfiles.workbench.layout.v1', scenes: 'dshfiles.workbench.semantic-layouts.v1' } as const
const titles = { a: 'Scope A conversation', b: 'Scope B conversation' } as const
const drafts = { a: 'Unsent draft remains owned by project A', b: 'Unsent draft remains owned by project B' } as const
const projectResult = z.object({ projectId: z.string() })
const createdResult = z.object({ sessionId: z.string() })
const threadList = z.object({ threads: z.array(z.object({ sessionId: z.string(), projectId: z.string().optional(), running: z.boolean() })) })
const persistedIdentity = z.object({ lastProjectKey: z.string().nullable() })
// Start from real Dockview serialization; validate the one-group shape before
// constructing the historical destination scene that predates the ordinary chooser.
const oneGroupLayout = z.looseObject({
  panels: z.record(z.string(), z.looseObject({ id: z.string() })),
  grid: z.looseObject({
    root: z.looseObject({
      type: z.literal('branch'),
      data: z.tuple([z.looseObject({ type: z.literal('leaf'), data: z.looseObject({ views: z.array(z.string()) }) })]),
    }),
  }),
})
interface ScopeJourney {
  readonly projects: { readonly a: string; readonly b: string }
  readonly sessions: { readonly a: string; readonly b: string }
  readonly chooser: string
  readonly order: readonly string[]
}
const journeys = new WeakMap<Page, ScopeJourney>()
const main = (page: Page): Locator => page.locator('[data-workbench-region="main"]')
const tab = (page: Page, key: keyof typeof titles): Locator => main(page).getByRole('tab', { name: titles[key], exact: true })
const body = (page: Page, sessionId: string): Locator => main(page).locator(`[data-workbench-panel-id=${JSON.stringify(tabPanelId(`thread:${sessionId}`))}]`)
const composer = (page: Page, sessionId: string): Locator =>
  body(page, sessionId).getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
const order = (page: Page): Promise<string[]> =>
  main(page)
    .locator('[role="tab"] [data-workbench-tab-id]')
    .evaluateAll(elements => elements.flatMap(element => element.getAttribute('data-workbench-tab-id') ?? []))
const readMain = async (page: Page) => {
  const raw = await page.evaluate(key => localStorage.getItem(key), KEYS.main)
  if (raw === null) throw new Error('Real Workbench main layout was not saved')
  return layoutSchema.parse(JSON.parse(raw))
}
const selected = async (page: Page, journey: ScopeJourney, key: keyof typeof titles): Promise<void> => {
  await expect(tab(page, key)).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(journey.sessions[key])
  await expect(body(page, journey.sessions[key]).locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', journey.sessions[key])
  await expect(composer(page, journey.sessions[key])).toBeVisible()
}

Given('an isolated two-project Workbench scope profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: [
      '@dshfiles/frame-layout',
      '@dshfiles/sidebar-right',
      '@dshfiles/workbench',
      '@dshfiles/main-tabs',
      '@dshfiles/thread-sidebar',
      '@dshfiles/workspace-folder-picker',
      '@dshfiles/session-controller',
      '@dshfiles/rich-composer',
      '@dshfiles/chat',
      '@dshfiles/multi-host',
      '@dshfiles/jj-integration',
      '@dshfiles/ai-accounts',
    ],
    profileLabel: 'workbench-cross-project-scope',
    cordisPatch: `- id: dshfiles-main-tabs
  config:
    enabled: true
    openMode: preview
    persistence: project
`,
  })
  await visitIsolatedPluginProfile(page, profile)
  await expect(main(page)).toBeVisible()
})

Given('two real projects have conversations in a legacy mixed Workbench scene', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const call = await connectDshxApi({ url: profile.url, packageId: '@dshfiles/thread-sidebar', apiId: 'thread-actions', version: 1 })
  const aPath = join(profile.homeRoot, 'scope-projects', 'alpha')
  const bPath = join(profile.homeRoot, 'scope-projects', 'beta')
  await mkdir(aPath, { recursive: true })
  await mkdir(bPath, { recursive: true })
  const projects = {
    a: projectResult.parse(await call('projectRegister', { path: aPath, title: 'Scope project A' })).projectId,
    b: projectResult.parse(await call('projectRegister', { path: bPath, title: 'Scope project B' })).projectId,
  }
  const sessions = {
    a: createdResult.parse(await call('create', { projectId: projects.a, title: titles.a, text: 'Message owned by project A' })).sessionId,
    b: createdResult.parse(await call('create', { projectId: projects.b, title: titles.b, text: 'Message owned by project B' })).sessionId,
  }
  await recordAssertion(page, 'scope-two-real-native-workspace-attachments', async () => {
    expect(projects.a).not.toBe(projects.b)
    expect(sessions.a).not.toBe(sessions.b)
    await expect
      .poll(async () => {
        const rows = threadList.parse(await call('list', {})).threads
        return [sessions.a, sessions.b].map(id => {
          const row = rows.find(candidate => candidate.sessionId === id)
          return row === undefined ? null : { projectId: row.projectId, running: row.running }
        })
      })
      .toEqual([
        { projectId: projects.a, running: false },
        { projectId: projects.b, running: false },
      ])
  })
  // Native startup reads the real Session route. No actor events or controller
  // replacements are injected: only the existing versioned persistence boundary.
  const route = new URL(profile.url)
  route.searchParams.set('thread', sessions.a)
  await page.goto(route.href)
  const aId = tabPanelId(`thread:${sessions.a}`)
  const bId = tabPanelId(`thread:${sessions.b}`)
  const tabA = { id: `thread:${sessions.a}`, target: { kind: 'thread' as const, sessionId: sessions.a }, pinned: false, preview: false, usedAt: 2 }
  const tabB = { id: `thread:${sessions.b}`, target: { kind: 'thread' as const, sessionId: sessions.b }, pinned: true, preview: false, usedAt: 1 }
  const legacy: PersistedTabs = {
    lastProjectKey: `project:${projects.a}`,
    sets: {
      [`project:${projects.a}`]: { tabs: [tabB, tabA], activeTabId: tabA.id },
      [`project:${projects.b}`]: { tabs: [tabA, tabB], activeTabId: tabA.id },
    },
  }
  await page.evaluate(
    ({ keys, legacy }) => {
      localStorage.setItem(keys.tabs, JSON.stringify(legacy))
      localStorage.setItem(keys.scenes, '{}')
    },
    { keys: KEYS, legacy },
  )
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(tab(page, 'a')).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, 'b')).toBeVisible()
  if ((await main(page).getByRole('tab', { name: 'New tab', exact: true }).count()) === 0) {
    await main(page).getByRole('button', { name: 'New tab', exact: true }).first().click()
  }
  await expect(main(page).getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(1)
  await tab(page, 'a').click()
  await expect.poll(async () => Object.keys((await readMain(page)).panels).sort()).toEqual(expect.arrayContaining([aId, bId]))
  const captured = await readMain(page)
  const chooser = Object.keys(captured.panels).find(id => id.startsWith('dshfiles-workbench.new-view/'))
  if (chooser === undefined) throw new Error('Fixture requires an ordinary NewView occurrence, not ActorStart')
  const origin = oneGroupLayout.parse(captured)
  origin.grid.root.data[0].data.views = [chooser, bId, aId]
  const layoutA = layoutSchema.parse(origin)
  const destination = oneGroupLayout.parse(structuredClone(layoutA))
  delete destination.panels[chooser]
  const leaf = destination.grid.root.data[0]
  leaf.data.views = [aId, bId]
  const sceneA = savedLayoutSchema.parse({ main: layoutA })
  const sceneB = savedLayoutSchema.parse({ main: layoutSchema.parse(destination) })
  // The destination is deliberately an older legitimate scene: same two real
  // conversations, different semantic order, no chooser. Selecting B must NOT
  // interpret B's native workspace as a request to restore this scene.
  await page.evaluate(
    ({ keys, legacy, sceneA, sceneB, projects, layoutA }) => {
      localStorage.setItem(keys.tabs, JSON.stringify(legacy))
      localStorage.setItem(keys.main, JSON.stringify(layoutA))
      localStorage.setItem(keys.scenes, JSON.stringify({ [`project:${projects.a}`]: sceneA, [`project:${projects.b}`]: sceneB }))
    },
    { keys: KEYS, legacy, sceneA, sceneB, projects, layoutA },
  )
  await StartupDialogs.reloadPastProviderSetup(page)
  const journey: ScopeJourney = { projects, sessions, chooser, order: [chooser, bId, aId] }
  journeys.set(page, journey)
  // Hydration intentionally preserves an ordinary chooser's initial focus.
  // Match the reported precondition by explicitly focusing the existing A tab.
  await tab(page, 'a').click()
  await selected(page, journey, 'a')
  await expect.poll(() => order(page)).toEqual(journey.order)
  await composer(page, sessions.a).fill(drafts.a)
  await page.screenshot({ path: test.info().outputPath('cross-project-before-a.png'), animations: 'disabled' })
  // The fixture is captured before the decisive click; this attached evidence
  // contains only its own identities and public versioned layout panel IDs.
  const path = test.info().outputPath('cross-project-scope-fixture.json')
  await writeFile(
    path,
    JSON.stringify(
      { projects, sessions, chooser, sceneA: Object.keys(layoutA.panels), sceneB: Object.keys(destination.panels), order: journey.order },
      null,
      2,
    ),
  )
  await test.info().attach('cross-project-scope-fixture', { path, contentType: 'application/json' })
})

When('the already-open other-project conversation is selected', async ({ page }: { page: Page }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('Two-project fixture missing')
  await tab(page, 'b').click()
  await selected(page, journey, 'b')
  await page.screenshot({ path: test.info().outputPath('cross-project-after-b.png'), animations: 'disabled' })
})

Then('the same chooser order pins and conversation drafts survive project-crossing switches and reload', async ({ page }: { page: Page }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('Two-project fixture missing')
  const assertScene = async () => {
    await expect(main(page).getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(1)
    await expect.poll(() => order(page)).toEqual(journey.order)
    await expect(tab(page, 'b').getByLabel('Pinned', { exact: true })).toBeVisible()
    const raw = await page.evaluate(key => localStorage.getItem(key), KEYS.tabs)
    expect(persistedIdentity.parse(raw === null ? null : JSON.parse(raw)).lastProjectKey).toBe(`project:${journey.projects.a}`)
  }
  await recordAssertion(page, 'scope-existing-other-project-keeps-ordinary-chooser', assertScene)
  await composer(page, journey.sessions.b).fill(drafts.b)
  await recordAssertion(page, 'scope-repeated-switches-preserve-two-fixed-drafts', async () => {
    for (const key of ['a', 'b', 'a', 'b'] as const) {
      await tab(page, key).click()
      await selected(page, journey, key)
      await assertScene()
      await expect(composer(page, journey.sessions[key])).toHaveText(drafts[key])
    }
  })
  await StartupDialogs.reloadPastProviderSetup(page)
  await recordAssertion(page, 'scope-reload-current-b-retains-a-scene-and-chooser', async () => {
    await selected(page, journey, 'b')
    await assertScene()
    for (const key of ['a', 'b'] as const) {
      await tab(page, key).click()
      await selected(page, journey, key)
      await expect(composer(page, journey.sessions[key])).toHaveText(drafts[key])
    }
  })
  await page.screenshot({ path: test.info().outputPath('cross-project-chooser-preserved.png'), animations: 'disabled' })
  await recordAssertion(page, 'scope-explicit-close-reload-never-resurrects-chooser', async () => {
    // The older project-scene cache deliberately still contains the chooser.
    // The current root layout, not that cache, owns the explicit close on reload.
    const cached = await page.evaluate(key => localStorage.getItem(key), KEYS.scenes)
    const scenes = z.record(z.string(), savedLayoutSchema).parse(cached === null ? null : JSON.parse(cached))
    expect(scenes[`project:${journey.projects.a}`]?.main?.panels[journey.chooser]).toBeDefined()
    await main(page).getByRole('tab', { name: 'New tab', exact: true }).getByRole('button', { name: 'Close New tab', exact: true }).click()
    await expect(main(page).getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(0)
    await selected(page, journey, 'b')
    await expect.poll(async () => Object.keys((await readMain(page)).panels)).not.toContain(journey.chooser)
    await StartupDialogs.reloadPastProviderSetup(page)
    await selected(page, journey, 'b')
    await expect(main(page).getByRole('tab', { name: 'New tab', exact: true })).toHaveCount(0)
    await expect.poll(() => order(page)).toEqual(journey.order.filter(id => id !== journey.chooser))
    for (const key of ['a', 'b'] as const) {
      await tab(page, key).click()
      await selected(page, journey, key)
      await expect(composer(page, journey.sessions[key])).toHaveText(drafts[key])
    }
  })
  await finishJourneyAssertions(page)
})
