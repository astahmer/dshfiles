import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { Then, When } from '../bdd.js'
import { recordAssertion } from '../steps.js'

const main = (page: Page): Locator => page.locator('[data-slot="shell.main"]')
const conversation = (page: Page): Locator => main(page).locator('[data-conversation-session]').filter({ visible: true })
const input = (page: Page): Locator => conversation(page).getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
const historyEnd = 'Long scrolling history final paragraph'
const draft = 'Unsent long-chat draft remains editable'
const passes = new WeakMap<Page, number>()

const measurements = (page: Page) =>
  conversation(page).evaluate(element => {
    const bounds = (node: Element | null) => {
      if (node === null) return null
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        display: style.display,
        overflowY: style.overflowY,
      }
    }
    return {
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      panel: bounds(element.closest('[data-workbench-panel-id]')),
      body: bounds(element),
      scroll: bounds(element.querySelector('[data-conversation-scroll]')),
      input: bounds(element.querySelector('[data-composer-input]')),
    }
  })

When('the second Workbench conversation receives a long history message', async ({ page }: { page: Page }) => {
  const composer = input(page)
  await expect(composer).toHaveCount(1)
  const text =
    Array.from(
      { length: 80 },
      (_, index) => `History paragraph ${index + 1}. This real user message must scroll inside the conversation, never grow the Dockview pane.`,
    ).join('\n\n') + `\n\n${historyEnd}`
  await composer.fill(text)
  await composer.press('Enter')
  await expect(conversation(page).locator('[data-chat-flow]')).toContainText(historyEnd)
  await expect(
    conversation(page)
      .getByRole('status')
      .filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ }),
  ).toHaveCount(2, { timeout: 60_000 })
})

Then('the long Workbench chat scrolls within its pane with its original editable input', async ({ page }: { page: Page }) => {
  const pass = (passes.get(page) ?? 0) + 1
  passes.set(page, pass)
  await recordAssertion(page, `workbench-long-chat-scroll-${pass}`, async () => {
    // Save geometry before actions: Playwright's auto-scroll must not conceal an off-screen composer.
    const geometry = await measurements(page)
    await writeFile(test.info().outputPath(`long-chat-geometry-${pass}.json`), JSON.stringify(geometry, null, 2))
    expect(geometry.panel).not.toBeNull()
    expect(geometry.body?.height).toBeLessThanOrEqual((geometry.panel?.height ?? 0) + 1)
    expect(geometry.scroll?.height).toBeLessThanOrEqual((geometry.panel?.height ?? 0) + 1)
    expect(geometry.input?.y).toBeGreaterThanOrEqual(geometry.panel?.y ?? 0)
    expect(geometry.input?.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight)
    expect(geometry.scroll?.scrollHeight).toBeGreaterThan((geometry.scroll?.clientHeight ?? 0) * 2)
    const composer = input(page)
    await expect(composer).toHaveCount(1)
    await expect(composer).toBeEditable()
    const original = await composer.elementHandle()
    if (original === null) throw new Error('The actual composer is missing.')
    const scroller = conversation(page).locator('[data-conversation-scroll]')
    const box = await scroller.boundingBox()
    if (box === null) throw new Error('The actual conversation scroller is missing.')
    await page.mouse.move(box.x + box.width / 2, box.y + 100)
    await page.mouse.wheel(0, -100_000)
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
    const atTop = await measurements(page)
    expect(atTop.input?.bottom).toBeLessThanOrEqual(atTop.viewportHeight)
    await page.mouse.wheel(0, 100_000)
    await expect.poll(() => scroller.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(2)
    // Native user messages preserve newlines inside one text block, not separate
    // paragraph elements. Measure the exact final text range, not the whole tall bubble.
    const lastParagraph = await conversation(page)
      .locator('[data-chat-flow]')
      .evaluate((element, marker) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node !== null) {
          const index = node.textContent?.indexOf(marker) ?? -1
          if (index >= 0) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + marker.length)
            const rect = range.getBoundingClientRect()
            return { y: rect.y, bottom: rect.bottom, width: rect.width, height: rect.height }
          }
          node = walker.nextNode()
        }
        return null
      }, historyEnd)
    expect(lastParagraph).not.toBeNull()
    expect(lastParagraph?.width).toBeGreaterThan(0)
    expect(lastParagraph?.height).toBeGreaterThan(0)
    expect(lastParagraph?.y).toBeGreaterThanOrEqual(box.y)
    expect(lastParagraph?.bottom).toBeLessThanOrEqual((await measurements(page)).input?.y ?? 0)
    expect(await composer.evaluate((element, previous) => element === previous, original)).toBe(true)
    if (pass > 1) await expect(composer).toHaveText(draft)
    await composer.fill(draft)
    await composer.press('End')
    await composer.pressSequentially(' editable')
    await expect(composer).toHaveText(`${draft} editable`)
    await composer.fill(draft)
    await test.info().attach(`long-chat-geometry-${pass}`, {
      body: JSON.stringify({ before: geometry, atTop, lastParagraph, after: await measurements(page) }),
      contentType: 'application/json',
    })
    if (pass === 3) await page.screenshot({ path: test.info().outputPath('workbench-long-chat-scroll.png'), animations: 'disabled' })
    await original.dispose()
  })
})

When('the long Workbench conversation is switched away and restored', async ({ page }: { page: Page }) => {
  await main(page).getByRole('tab', { name: 'Workbench first conversation', exact: true }).click()
  await expect(conversation(page).locator('[data-chat-flow]')).not.toContainText(historyEnd)
  await main(page).getByRole('tab', { name: 'Workbench second conversation', exact: true }).click()
  await expect(conversation(page).locator('[data-chat-flow]')).toContainText(historyEnd)
})
