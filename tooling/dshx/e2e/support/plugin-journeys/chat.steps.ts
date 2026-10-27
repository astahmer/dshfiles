import { expect, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { When, Then } from '../bdd.js'
import { profileFor, recordAssertion, finishJourneyAssertions } from '../steps.js'
import { seedInterruptedSession } from '../seed-interrupted-session.mjs'
import { seedChatImageLinkSession } from '../seed-chat-image-link-session.mjs'

const replayMarker = 'provider-replay-private-marker'
const browserFrames = new WeakMap<Page, string[]>()

const seedTranscript = async (homeRoot: string, rowCount: number): Promise<void> => {
  const projectRequire = createRequire(new URL('../../../../../plugins/@dshfiles/session-controller/package.json', import.meta.url))
  const require = createRequire(projectRequire.resolve('@deepseek-ai/dsh/package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const persistence = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
  const { SessionId } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
  const { createAssistantMessage, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
  const context = new Context()
  try {
    await context.plugin(persistence, { root: join(homeRoot, 'sessions') })
    const handle = await context.sessionPersistence.create({
      id: SessionId('session-chat-transcript-window-fixture'),
      createdAt: Date.now(),
      cwd: '/tmp',
      version: 4,
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'standard',
    })
    const events = [
      { type: 'permission/preset', seq: 0, time: 100, data: { preset: 'workspace-write' } },
      { type: 'session/title', seq: 1, time: 200, data: { title: 'Chat transcript window fixture', messageSeqs: [], source: { kind: 'user' } } },
    ]
    let seq = 2
    for (let row = 1; row <= rowCount; row++) {
      events.push({ type: 'turn/start', seq: seq++, time: 300 + row * 10, data: { turn: row } })
      events.push({
        type: 'user/message',
        seq: seq++,
        time: 301 + row * 10,
        surfaceOp: 'append',
        data: createUserMessage({ content: [{ type: 'text', text: `Transcript question ${row}` }], source: { kind: 'user' } }),
      })
      events.push({ type: 'step/start', seq: seq++, time: 302 + row * 10, data: { turn: row, step: 1 } })
      const source = {
        provider: 'fixture',
        model: 'fixture',
        ...(row === rowCount ? { replayState: { response: { id: 'fixture_response', stopReason: 'toolUse' }, blocks: [{ signature: replayMarker }] } } : {}),
      }
      events.push({
        type: 'assistant/message',
        seq: seq++,
        time: 303 + row * 10,
        surfaceOp: 'append',
        data: { turn: row, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: `Transcript answer ${row}` }], source }), stream: [] },
      })
      events.push({ type: 'step/end', seq: seq++, time: 304 + row * 10, data: { turn: row, step: 1 } })
      events.push({ type: 'turn/end', seq: seq++, time: 305 + row * 10, data: { turn: row, reason: { kind: 'completed' } } })
    }
    await handle.append(events)
    await handle.flush()
    await handle.close()
  } finally {
    await context.fiber.dispose()
  }
}

When('a thread with two interrupted tasks is opened', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await seedInterruptedSession({ homeRoot: profile.homeRoot, profileRoot: `${profile.homeRoot}/profiles/${profile.profile}` })
  const fixture = page.getByRole('treeitem', { name: /Untitled|Interrupted resume fixture/ })
  await expect
    .poll(
      async () => {
        await page.reload()
        if ((await fixture.count()) === 0) await page.getByText('Ungrouped', { exact: true }).first().click()
        await fixture
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
  await page.getByText('Task stopped', { exact: true }).first().waitFor()
})

Then('only the latest stopped notice offers Resume', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-latest-interrupted-only', async () => {
    await expect(page.getByText('Task stopped', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(1)
  })
})

When('the latest stopped task is resumed inline', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
})

Then('the stopped notices remain but Resume disappears', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-resumed-task-hides-action', async () => {
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0)
    await expect(page.getByText('Task stopped', { exact: true })).toHaveCount(2)
    await expect(page.getByText('Continue the interrupted task', { exact: false }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const openTranscriptFixture = async (page: Page, rowCount: number): Promise<void> => {
  const profile = profileFor(page)
  await seedTranscript(profile.homeRoot, rowCount)
  const fixture = page.getByRole('treeitem', { name: /Untitled|Chat transcript window fixture/ })
  await expect
    .poll(
      async () => {
        await page.reload()
        if ((await fixture.count()) === 0) await page.getByText('Ungrouped', { exact: true }).first().click()
        await fixture
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
}

When('a real thread with one hundred eighty transcript turns is opened', async ({ page }: { page: Page }) => {
  await openTranscriptFixture(page, 180)
})

Then('the latest transcript rows are visible and older rows appear when scrolling up', async ({ page }: { page: Page }) => {
  const scrollport = page.locator('[data-conversation-scroll]').first()
  await recordAssertion(page, 'chat-windowed-transcript-starts-at-tail', async () => {
    await expect(page.getByText('Transcript answer 180', { exact: true })).toBeVisible()
    await expect(page.getByText('Transcript answer 1', { exact: true })).toHaveCount(0)
  })
  await scrollport.hover()
  for (let attempt = 0; attempt < 12; attempt++) await page.mouse.wheel(0, -600)
  await expect(page.getByText('Transcript answer 1', { exact: true })).toBeVisible({ timeout: 10_000 })
  await recordAssertion(
    page,
    'chat-windowed-transcript-mounts-older-rows-on-scroll',
    async () => await expect(page.getByText('Transcript answer 1', { exact: true })).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

Then('each upward wheel step moves the rows under the reader by the wheel distance', async ({ page }: { page: Page }) => {
  await expect(page.getByText('Transcript answer 180', { exact: true })).toBeVisible()
  const scrollport = page.locator('[data-conversation-scroll]').first()
  await scrollport.hover()
  const wheelStep = 240
  // One wheel tick of slack: a burst can split across a frame boundary in a headless browser.
  const wheelTick = wheelStep / 4
  const readerRow = () =>
    page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      if (scroller === null) return null
      const scrollerTop = scroller.getBoundingClientRect().top
      const row = [...scroller.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')].find(
        candidate => candidate.getBoundingClientRect().top >= scrollerTop + 40,
      )
      return row === undefined ? null : { key: row.dataset.chatAnchorKey ?? '', top: row.getBoundingClientRect().top, scrollTop: scroller.scrollTop }
    })
  const rowTop = (key: string) =>
    page.evaluate(anchorKey => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')].find(candidate => candidate.dataset.chatAnchorKey === anchorKey)
      return row === undefined ? null : row.getBoundingClientRect().top
    }, key)
  const jumps: string[] = []
  for (let step = 0; step < 40; step++) {
    const before = await readerRow()
    if (before === null || before.scrollTop <= 0) break
    for (let burst = 0; burst < 4; burst++) await page.mouse.wheel(0, -wheelTick)
    await page.waitForTimeout(350)
    const after = await rowTop(before.key)
    if (after === null) {
      jumps.push(`step ${step}: ${before.key.slice(0, 40)} unmounted`)
      continue
    }
    const moved = after - before.top
    const expected = Math.min(wheelStep, before.scrollTop)
    if (Math.abs(moved - expected) > wheelTick)
      jumps.push(`step ${step}: ${before.key.slice(0, 40)} moved ${Math.round(moved)}px for a ${expected}px wheel (scrollTop ${Math.round(before.scrollTop)})`)
  }
  await recordAssertion(page, 'chat-windowed-transcript-scrolls-without-jumps', () => expect(jumps).toEqual([]))
  await finishJourneyAssertions(page)
})

When('a real Host session with provider replay data is opened', async ({ page }: { page: Page }) => {
  const frames: string[] = []
  browserFrames.set(page, frames)
  page.on('websocket', socket =>
    socket.on('framereceived', frame => frames.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8'))),
  )
  await openTranscriptFixture(page, 1)
})

Then('the browser renders the response without receiving provider replay blocks', async ({ page }: { page: Page }) => {
  const frames = browserFrames.get(page) ?? []
  await expect(page.getByText('Transcript answer 1', { exact: true })).toBeVisible()
  await expect.poll(() => frames.length, { timeout: 10_000 }).toBeGreaterThan(0)
  await recordAssertion(page, 'session-controller-browser-follow-omits-provider-blocks', () => {
    expect(frames.join('\n')).toContain('Transcript answer 1')
    expect(frames.join('\n')).not.toContain(replayMarker)
  })
  await finishJourneyAssertions(page)
})

When('a chat thread with a local image link is opened', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await seedChatImageLinkSession({ homeRoot: profile.homeRoot })
  const fixture = page.getByRole('treeitem', { name: /Untitled|Chat image link fixture/ })
  await expect
    .poll(
      async () => {
        await page.reload()
        if ((await fixture.count()) === 0) await page.getByText('Ungrouped', { exact: true }).first().click()
        await fixture
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
  const imageLink = page.getByRole('button', { name: 'red.png', exact: true })
  await imageLink.scrollIntoViewIfNeeded()
  const backToBottom = page.getByRole('button', { name: 'Back to bottom', exact: true })
  await expect(backToBottom).toBeVisible()
  await imageLink.click()
})

Then('the image link opens in the gallery rather than a side panel', async ({ page }: { page: Page }) => {
  const lightbox = page.getByRole('dialog', { name: 'Image preview', exact: true })
  const backToBottom = page.getByRole('button', { name: 'Back to bottom', exact: true })
  const rightSidebar = page.getByRole('button', { name: 'Open right sidebar', exact: true })
  const leftSidebarGroup = page.getByRole('treeitem', { name: 'Ungrouped', exact: true })
  const composer = page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
  const pointIsInsideLightbox = async (element: Locator): Promise<boolean> =>
    element.evaluate(target => {
      const bounds = target.getBoundingClientRect()
      const topElement = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      return topElement?.closest('[role="dialog"][aria-label="Image preview"]') !== null
    })
  await recordAssertion(page, 'chat-image-link-opens-gallery', async () => {
    await expect(lightbox).toBeVisible()
    await expect(lightbox.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    await expect(backToBottom).toBeVisible()
    await expect(rightSidebar).toBeVisible()
    await expect(leftSidebarGroup).toBeVisible()
    await expect(composer).toBeVisible()
    const backdropStyle = await lightbox.locator('div[aria-hidden="true"]').evaluate(element => {
      const computed = getComputedStyle(element)
      const alpha = computed.backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1]
      return {
        alpha: alpha === undefined ? 1 : Number(alpha),
        backdropFilter: computed.backdropFilter,
      }
    })
    expect(backdropStyle.alpha).toBeGreaterThan(0.4)
    expect(backdropStyle.backdropFilter).toContain('blur(')
    const lightboxZIndex = await lightbox.evaluate(element => Number(getComputedStyle(element).zIndex))
    expect(lightboxZIndex).toBeGreaterThan(1100)
    expect(await pointIsInsideLightbox(backToBottom)).toBe(true)
    expect(await pointIsInsideLightbox(rightSidebar)).toBe(true)
    expect(await pointIsInsideLightbox(leftSidebarGroup)).toBe(true)
    expect(await pointIsInsideLightbox(composer)).toBe(true)
  })
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()
  await finishJourneyAssertions(page)
})
