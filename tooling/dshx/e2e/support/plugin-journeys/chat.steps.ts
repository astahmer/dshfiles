import { expect, test, type Locator, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Given, When, Then } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import { profileFor, recordAssertion, finishJourneyAssertions, visitIsolatedPluginProfile } from '../steps.js'
import { seedFailedFirstRequestSession, seedInterruptedSession } from '../seed-interrupted-session.mjs'
import { seedChatImageLinkSession } from '../seed-chat-image-link-session.mjs'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const replayMarker = 'provider-replay-private-marker'
const browserFrames = new WeakMap<Page, string[]>()

const LONG_ANSWER_PARAGRAPHS = 60

const seedTranscript = async (homeRoot: string, rowCount: number, options: { readonly longFinalAnswer?: boolean } = {}): Promise<void> => {
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
        data: {
          turn: row,
          step: 1,
          message: createAssistantMessage({
            content: [
              {
                type: 'text',
                text:
                  options.longFinalAnswer === true && row === rowCount
                    ? [
                        `Transcript answer ${row}`,
                        ...Array.from({ length: LONG_ANSWER_PARAGRAPHS }, (_, index) => `Answer paragraph ${index + 1}`),
                        'Answer end',
                      ].join('\n\n')
                    : `Transcript answer ${row}`,
              },
            ],
            source,
          }),
          stream: [],
        },
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

const openSeededThread = async (page: Page, title: RegExp): Promise<void> => {
  const fixture = page.getByRole('treeitem', { name: title })
  const ungrouped = page.getByText('Ungrouped', { exact: true }).first()
  await expect
    .poll(
      async () => {
        await page.reload()
        // A thread seeded before boot lists under its workspace; one seeded after it may sit in a collapsed Ungrouped.
        await fixture
          .or(ungrouped)
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        if ((await fixture.count()) === 0) await ungrouped.click({ timeout: 3_000 }).catch(() => undefined)
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

When('a thread with two interrupted tasks is opened', async ({ page }: { page: Page }) => {
  await seedInterruptedSession({ homeRoot: profileFor(page).homeRoot })
  await openSeededThread(page, /Untitled|Interrupted resume fixture/)
  await page.getByText('Task stopped', { exact: true }).first().waitFor()
})

When('a thread whose first request failed is opened', async ({ page }: { page: Page }) => {
  await seedFailedFirstRequestSession({ homeRoot: profileFor(page).homeRoot })
  await openSeededThread(page, /Untitled|Failed first request fixture/)
  await page.getByText('Not logged in', { exact: false }).first().waitFor()
})

Then('the failed turn offers Retry instead of Resume', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-failed-turn-offers-retry', async () => {
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0)
  })
})

When('the failed turn is retried inline', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
})

Then('the request runs again without a continue prompt', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-retried-turn-adds-no-prompt', async () => {
    // The seeded thread has no model of its own, so the rerun request fails again on the default route: that second
    // failure proves the request ran, and only the newest failed turn keeps the action.
    await expect(page.getByText('This turn failed', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(1)
    await expect(page.getByText('Execution requested', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Continue the interrupted task', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Say hello', { exact: true })).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
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
  await openSeededThread(page, /Untitled|Chat transcript window fixture/)
}

// session-search serves the Session list from a cache that a log written behind the Host does not invalidate, so the
// transcript is seeded before the Host starts.
Given(
  'the isolated plugin composition of {string} is booted with a one hundred eighty turn transcript',
  async ({ page }: { page: Page }, packageList: string) => {
    const packageIds = packageList.split(',').map(packageId => packageId.trim())
    const [packageId, ...companionPackageIds] = packageIds
    if (packageId === undefined || packageId === '') throw new Error('The plugin composition names no package.')
    const profile = await bootComposedPluginProfile({
      packageIds: [packageId, ...companionPackageIds],
      profileLabel: `${packageList}-transcript`,
      seedHome: homeRoot => seedTranscript(homeRoot, 180),
    })
    await visitIsolatedPluginProfile(page, profile)
  },
)

When('the seeded transcript thread is opened', async ({ page }: { page: Page }) => {
  await openSeededThread(page, /Untitled|Chat transcript window fixture/)
})

When('a thread with a long unread final answer is opened', async ({ page }: { page: Page }) => {
  await seedTranscript(profileFor(page).homeRoot, 12, { longFinalAnswer: true })
  await openSeededThread(page, /Untitled|Chat transcript window fixture/)
})

Then('the thread opens at the start of its final answer under a New divider', async ({ page }: { page: Page }) => {
  const scrollport = page.locator('[data-conversation-scroll]').first()
  await recordAssertion(page, 'chat-unread-thread-opens-at-final-answer', async () => {
    await expect(scrollport.getByText('Transcript answer 12', { exact: true })).toBeInViewport({ timeout: 15_000 })
    await expect(scrollport.getByText('Answer end', { exact: true })).not.toBeInViewport()
    await expect(scrollport.locator('[data-chat-unread-label="New"]')).toHaveCount(1)
  })
  await page.screenshot({ path: test.info().outputPath('chat-unread-final-answer.png'), animations: 'disabled' })
  const wide = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await recordAssertion(page, 'chat-unread-divider-fits-a-phone', async () => {
    const divider = scrollport.locator('[data-chat-unread-label="New"]')
    await expect(divider).toBeVisible()
    const box = await divider.boundingBox()
    expect(box === null ? Number.POSITIVE_INFINITY : box.x + box.width).toBeLessThanOrEqual(390)
  })
  await page.screenshot({ path: test.info().outputPath('chat-unread-final-answer-390.png'), animations: 'disabled' })
  if (wide !== null) await page.setViewportSize(wide)
})

When('the reader reaches its end and opens the thread again', async ({ page }: { page: Page }) => {
  const scrollport = page.locator('[data-conversation-scroll]').first()
  await scrollport.hover()
  const end = scrollport.getByText('Answer end', { exact: true })
  for (let round = 0; round < 20 && !(await end.isVisible()); round++) await page.mouse.wheel(0, 2_000)
  await page.mouse.wheel(0, 4_000)
  await expect(page.locator('[data-chat-following-tail]')).toHaveCount(1)
  await openSeededThread(page, /Untitled|Chat transcript window fixture/)
})

Then('the thread opens at its end without a divider', async ({ page }: { page: Page }) => {
  const scrollport = page.locator('[data-conversation-scroll]').first()
  await recordAssertion(page, 'chat-read-thread-opens-at-end', async () => {
    await expect(scrollport.getByText('Answer end', { exact: true })).toBeInViewport({ timeout: 15_000 })
    await expect(scrollport.locator('[data-chat-unread-label]')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

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
  // One wheel per round, then the rows it mounts: a burst fired before older rows mount loses its distance at the top.
  const oldest = page.getByText('Transcript answer 1', { exact: true })
  const mountedRows = () => page.locator('[data-conversation-scroll] [data-chat-anchor-key]').count()
  const deadline = Date.now() + 30_000
  for (let round = 0; round < 40 && Date.now() < deadline && (await oldest.count()) === 0; round++) {
    const before = await mountedRows()
    await page.mouse.wheel(0, -600)
    await expect
      .poll(async () => (await oldest.count()) > 0 || (await mountedRows()) > before, { timeout: 750, intervals: [50, 100, 200] })
      .toBe(true)
      .catch(() => undefined)
  }
  await expect(oldest).toBeVisible({ timeout: 5_000 })
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

Then('find in thread jumps to an unmounted turn and steps through every match', async ({ page }: { page: Page }) => {
  await expect(page.getByText('Transcript answer 180', { exact: true })).toBeVisible()
  await expect(page.getByText('Transcript question 42', { exact: true })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+f')
  // The fork's find bar (productivity pass Q4; the merge of 2026-11-11 kept it over upstream's): numbered from the newest.
  const bar = page.getByRole('search', { name: 'Find in thread', exact: true })
  const field = bar.getByRole('searchbox', { name: 'Find in thread', exact: true })
  const count = bar.locator('[data-thread-find-count]')
  await expect(field).toBeFocused()
  await field.fill('question 42')
  await recordAssertion(page, 'chat-find-in-thread-jumps-to-unmounted-turn', async () => {
    await expect(count).toHaveText('1 of 1', { timeout: 20_000 })
    await expect(page.getByText('Transcript question 42', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
  // "4" is a prefix of turns 4 and 40-49: eleven user messages. The bar lands on the newest one at or above the reader
  // (turn 42 is on screen), so step newer (Shift+Enter) to the newest, numbered 1.
  await field.fill('question 4')
  await expect(count).toHaveText(/^\d+ of 11$/u, { timeout: 20_000 })
  for (let step = 0; step < 11 && (await count.textContent()) !== '1 of 11'; step += 1) await field.press('Shift+Enter')
  await expect(count).toHaveText('1 of 11')
  // Shift+Enter wraps from the newest to the oldest match, turn 4.
  await field.press('Shift+Enter')
  await recordAssertion(page, 'chat-find-in-thread-steps-through-matches', async () => {
    await expect(count).toHaveText('11 of 11')
    await expect(page.getByText('Transcript question 4', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
  await field.press('Enter')
  await expect(count).toHaveText('1 of 11')
  await field.press('Escape')
  await recordAssertion(page, 'chat-find-in-thread-closes', async () => {
    await expect(bar).toHaveCount(0)
  })
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

const openImageLinkFixture = async (page: Page): Promise<void> => {
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
  await page
    .getByText(/^Worked for /)
    .last()
    .click()
}

When('a chat thread with a local image link is opened', async ({ page }: { page: Page }) => {
  await openImageLinkFixture(page)
  const imageLink = page.getByRole('button', { name: 'red.png', exact: true })
  await imageLink.scrollIntoViewIfNeeded()
  const backToBottom = page.getByRole('button', { name: 'Back to bottom', exact: true })
  await expect(backToBottom).toBeVisible()
  await imageLink.click()
})

When('a read image tool summary path is opened', async ({ page }: { page: Page }) => {
  await openImageLinkFixture(page)
  await page.getByRole('button', { name: 'Read images', exact: true }).last().click()
  await page.getByRole('button', { name: 'blue.png', exact: true }).click()
})

When('thread gallery scope is selected and a read image path is opened', async ({ page }: { page: Page }) => {
  await openImageLinkFixture(page)
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menuitem', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Current turn', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Entire thread', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Read images', exact: true }).last().click()
  await page.getByRole('button', { name: 'blue.png', exact: true }).click()
})

Then('the thread gallery includes images from other turns', async ({ page }: { page: Page }) => {
  const lightbox = page.getByRole('dialog', { name: 'Image preview', exact: true })
  await recordAssertion(page, 'chat-thread-gallery-includes-older-turns', async () => {
    await expect(lightbox).toBeVisible()
    await expect(lightbox.getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
    await expect(lightbox.getByRole('button', { name: 'Image 1 of 3', exact: true })).toBeVisible()
    await expect(lightbox.getByRole('button', { name: 'Image 3 of 3', exact: true })).toBeVisible()
  })
  await lightbox.getByRole('button', { name: 'Next image', exact: true }).click()
  await expect(lightbox.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
  const thirdThumbnail = lightbox.getByRole('button', { name: 'Image 3 of 3', exact: true })
  await thirdThumbnail.click()
  await expect(thirdThumbnail).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()
  await finishJourneyAssertions(page)
})

Then('the read image tool path opens in a navigable gallery rather than a side panel', async ({ page }: { page: Page }) => {
  const lightbox = page.getByRole('dialog', { name: 'Image preview', exact: true })
  await recordAssertion(page, 'chat-read-image-opens-turn-gallery', async () => {
    await expect(lightbox).toBeVisible()
    await expect(lightbox.getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
    await expect(lightbox.getByRole('button', { name: 'Image 1 of 2', exact: true })).toBeVisible()
    await expect(lightbox.getByRole('button', { name: 'Image 2 of 2', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open right sidebar', exact: true })).toBeVisible()
  })
  await lightbox.getByRole('button', { name: 'Next image', exact: true }).click()
  await expect(lightbox.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
  await lightbox.getByRole('button', { name: 'Image 1 of 2', exact: true }).click()
  await expect(lightbox.getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()
  await finishJourneyAssertions(page)
})

Then('the image link opens in the gallery rather than a side panel', async ({ page }: { page: Page }) => {
  const lightbox = page.getByRole('dialog', { name: 'Image preview', exact: true })
  const backToBottom = page.getByRole('button', { name: 'Back to bottom', exact: true })
  const rightSidebar = page.getByRole('button', { name: 'Open right sidebar', exact: true })
  const leftSidebarGroup = page.getByRole('treeitem', { name: 'Ungrouped', exact: true })
  const composer = page.getByRole('textbox', { name: /^Message or run a task, \/ commands, @ files or (?:threads|sessions)$/u })
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

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/

const sendPrompt = async (page: Page, text: string): Promise<void> => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(text)
  await composer.press('Enter')
}

When('the fake model answers, then answers again at High effort in a fresh workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-chat-route-change-')
  const workspace = join(root, 'chat-route-change')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'chat-route-change', model: 'commandcode_work/gpt-6-luna' })
  const answers = page.getByText(/^Answered by /)
  await sendPrompt(page, 'Say hello')
  await expect(answers).toHaveCount(1, { timeout: 60_000 })
  await page
    .getByRole('button', { name: /gpt-6-luna/ })
    .last()
    .click()
  await page.getByText('Effort', { exact: true }).click()
  await page.getByText('High', { exact: true }).click()
  await sendPrompt(page, 'Say hello again')
  await expect(answers).toHaveCount(2, { timeout: 60_000 })
})

Then('the transcript marks the effort change once', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-route-change-marks-effort', async () => {
    await expect(page.getByRole('note', { name: 'Effort default → high', exact: true })).toBeVisible()
    await expect(page.locator('[data-chat-route-change]')).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})
