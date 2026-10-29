import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const HTML_RENDER_DIRECTORY = join(DSHFILES_ROOT, 'plugins/@dshfiles/html-render')
const PAGE_TITLE = 'Isolation probe'
const PROBE_HTML = [
  '<h2>Isolation probe</h2><p id="probe">pending</p><script>',
  'const results = [];',
  'try { results.push(parent.document.title === undefined ? "parent-empty" : "parent-readable") } catch { results.push("parent-blocked") }',
  'try { results.push(localStorage.length >= 0 ? "storage-readable" : "storage-empty") } catch { results.push("storage-blocked") }',
  'const probe = document.getElementById("probe");',
  'document.addEventListener("securitypolicyviolation", event => { results.push("csp:" + event.effectiveDirective); probe.textContent = results.join(" ") });',
  'probe.textContent = results.join(" ");',
  'fetch("https://example.com/").catch(() => undefined);',
  '</script>',
].join('')
const PUBLISH_DIRECTIVE = `[[call html_render ${JSON.stringify({ title: PAGE_TITLE, html: PROBE_HTML, height: 240 })}]]`

When('the fake model publishes an isolation probe page with html_render', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, HTML_RENDER_DIRECTORY)
  await startThreadWithModel(page, { project: 'html-render', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(PUBLISH_DIRECTIVE)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/^Completed in /).last()).toBeVisible()
})

const expectIsolatedPage = async (page: Page): Promise<void> => {
  const card = page.getByRole('region', { name: PAGE_TITLE })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.locator('iframe[data-html-render-frame]')).toHaveAttribute('sandbox', 'allow-scripts')
  const frame = card.frameLocator('iframe[data-html-render-frame]')
  await expect(frame.getByRole('heading', { name: PAGE_TITLE })).toBeVisible()
  await expect(frame.locator('#probe')).toHaveText('parent-blocked storage-blocked csp:connect-src', { timeout: 10_000 })
}

Then('the completed turn shows the page in a sandboxed card without network or parent access', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'html-render-card-is-sandboxed', () => expectIsolatedPage(page))
})

Then('the card opens in a new tab, still sandboxed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'html-render-card-opens-in-new-tab', async () => {
    const popupOpened = page.context().waitForEvent('page')
    await page.getByRole('region', { name: PAGE_TITLE }).getByRole('button', { name: 'Open in new tab' }).click()
    const popup = await popupOpened
    const frame = popup.locator('iframe')
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(popup.frameLocator('iframe').locator('#probe')).toHaveText(/^parent-blocked storage-blocked( csp:connect-src)+$/, { timeout: 10_000 })
    await expect(popup.locator('script')).toHaveCount(0)
    await popup.close()
  })
})

Then('the card expands to full screen and is still there after a reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'html-render-card-expands', async () => {
    await page.getByRole('region', { name: PAGE_TITLE }).getByRole('button', { name: 'Expand' }).click()
    const dialog = page.getByRole('dialog', { name: PAGE_TITLE })
    await expect(dialog.frameLocator('iframe[data-html-render-frame]').getByRole('heading', { name: PAGE_TITLE })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
  await recordAssertion(page, 'html-render-card-survives-reload', async () => {
    await page.reload()
    await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/^Completed in /).last()).toBeVisible()
    await expectIsolatedPage(page)
  })
})

const PREVIEW_TITLE = 'Preview fixture'
const PREVIEW_DIRECTIVE = `[[call html_preview ${JSON.stringify({ path: 'fixtures/preview/index.html', title: PREVIEW_TITLE, height: 200 })}]]`

When('the fake model shows a workspace HTML file with html_preview', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(PREVIEW_DIRECTIVE)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toHaveCount(2, { timeout: 60_000 })
})

Then('the preview card shows the file with its relative stylesheet and script inlined', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'html-preview-card-inlines-assets', async () => {
    const card = page.getByRole('region', { name: PREVIEW_TITLE })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.locator('iframe[data-html-render-frame]')).toHaveAttribute('sandbox', 'allow-scripts')
    const frame = card.frameLocator('iframe[data-html-render-frame]')
    await expect(frame.getByRole('heading', { name: PREVIEW_TITLE })).toBeVisible()
    await expect(frame.locator('#status')).toHaveText('stylesheet and script inlined', { timeout: 10_000 })
  })
  await finishJourneyAssertions(page)
})
