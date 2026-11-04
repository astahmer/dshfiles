import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const PROJECT_DIRECTORY = join(DSHFILES_ROOT, 'plugins/@dshfiles/user-questions')
const PREVIEW_TITLE = 'Lines per layout'
const PREVIEW_HTML = [
  "<style>.bars{display:flex;align-items:end;gap:8px;height:90px}.bars div{flex:1;background:var(--dsh-accent)}</style>",
  "<div class='bars'><div style='height:100%'></div><div style='height:64%'></div></div><p id='probe'>pending</p><script>",
  'const results = [];',
  'try { results.push(parent.document.title === undefined ? "parent-empty" : "parent-readable") } catch { results.push("parent-blocked") }',
  'const probe = document.getElementById("probe");',
  'document.addEventListener("securitypolicyviolation", event => { results.push("csp:" + event.effectiveDirective); probe.textContent = results.join(" ") });',
  'probe.textContent = results.join(" ");',
  'fetch("https://example.com/").catch(() => undefined);',
  '</script>',
].join('')
const QUESTION = [
  'Pick a layout for [the release notes](https://example.test/notes)',
  '',
  'Both drafts list the same **12 changes**:',
  '',
  '| Layout | Lines |',
  '| --- | ---: |',
  '| Grouped | 48 |',
  '| Flat | 31 |',
  '',
  `\`\`\`html preview ${PREVIEW_TITLE}`,
  PREVIEW_HTML,
  '```',
  '',
  '```html',
  '<p>shown as code</p>',
  '```',
  '',
  'Which one should ship?',
].join('\n')
const ARGUMENTS = {
  questions: [
    {
      id: 'layout',
      header: 'Release notes',
      question: QUESTION,
      options: [
        { label: 'Grouped by plugin (Recommended)', description: 'Each plugin gets a heading, in `package.json` order.' },
        { label: 'One flat list', description: 'Shorter, but **no grouping**; see [the flat draft](https://example.test/flat).' },
      ],
    },
  ],
  timeout: -1,
}
const ASK_DIRECTIVE = `[[once call ask_user_question ${JSON.stringify(ARGUMENTS)}]]`

const questionCard = (page: Page) => page.locator('[data-question-key]').last()

When('the fake model asks a markdown question with an html preview', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, PROJECT_DIRECTORY)
  await startThreadWithModel(page, { project: 'user-questions', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(ASK_DIRECTIVE)
  await composer.press('Enter')
  await expect(questionCard(page)).toBeVisible({ timeout: 60_000 })
})

Then('the question form renders the markdown heading, table and option descriptions', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'markdown-question-heading-body-options', async () => {
    const card = questionCard(page)
    const heading = card.getByRole('heading', { level: 2, name: 'Pick a layout for the release notes' })
    await expect(heading).toBeVisible()
    await expect(heading.getByRole('link', { name: 'the release notes' })).toHaveAttribute('href', 'https://example.test/notes')
    await expect(card.locator('[data-question-markdown] strong', { hasText: '12 changes' })).toBeVisible()
    await expect(card.locator('[data-question-markdown] table td')).toHaveCount(4)
    // A plain html fence is code: its markup is text, never a frame.
    await expect(card.locator('[data-question-markdown]').getByText('<p>shown as code</p>')).toBeVisible()
    await expect(card.locator('iframe')).toHaveCount(1)
    await expect(card.getByRole('radio')).toHaveCount(2)
    await expect(card.getByRole('radio', { name: 'One flat list' })).toHaveAccessibleDescription(/Shorter, but no grouping/)
    await expect(card.locator('[data-question-option-description] code', { hasText: 'package.json' })).toBeVisible()
  })
})

Then('the html preview runs in a sandboxed card without network or parent access', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'markdown-question-preview-is-sandboxed', async () => {
    const preview = questionCard(page).getByRole('region', { name: PREVIEW_TITLE })
    await expect(preview).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('iframe[data-html-render-frame]')).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(preview.frameLocator('iframe[data-html-render-frame]').locator('#probe')).toHaveText('parent-blocked csp:connect-src', {
      timeout: 10_000,
    })
  })
})

Then('clicking an option description picks it while its link stays a link', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'markdown-question-description-selects', async () => {
    const card = questionCard(page)
    const flat = card.getByRole('radio', { name: 'One flat list' })
    const description = card.locator('[data-question-option-description]').nth(1)
    const link = description.getByRole('link', { name: 'the flat draft' })
    await expect(link).toHaveAttribute('href', 'https://example.test/flat')
    // A link click must not pick the option; stop the navigation so the page stays.
    await link.evaluate(element => element.addEventListener('click', event => event.preventDefault(), { once: true }))
    await link.click()
    await expect(flat).toHaveAttribute('aria-checked', 'false')
    await description.click({ position: { x: 2, y: 2 } })
    await expect(flat).toHaveAttribute('aria-checked', 'true')
    await expect(card.getByRole('radio', { name: 'Grouped by plugin' })).toHaveAttribute('aria-checked', 'false')
  })
})

Then('the question form fits a phone-width viewport', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'markdown-question-fits-phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const card = questionCard(page)
    await expect(card.getByRole('region', { name: PREVIEW_TITLE })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)
    await expect(card.getByRole('button', { name: 'Submit' })).toBeInViewport()
  })
  await finishJourneyAssertions(page)
})
