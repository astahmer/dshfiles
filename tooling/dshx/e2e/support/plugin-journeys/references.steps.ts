import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, selectModelForNewThread, sendMessage } from '../threads.js'

const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const referenceFolders = new WeakMap<Page, string>()

When('a new thread on the fake model answers a first message', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  await sendMessage(page, 'First message of the journey')
})

When('the reference {string} is saved from a scratch folder with the \\/reference command', async ({ page }: { page: Page }, name: string) => {
  const folder = await createScratchDirectory('dshx-references-e2e-')
  await writeFile(join(folder, 'README.md'), '# Reference docs\n')
  referenceFolders.set(page, folder)
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true })
  await composer.fill(`/reference save ${name} ${folder}`)
  await composer.press('Enter')
})

Then('the command reports {string} as saved and attached', async ({ page }: { page: Page }, name: string) => {
  await recordAssertion(page, 'references-save-command', () =>
    expect(page.getByText(new RegExp(`^Saved and attached ${name} · `))).toBeVisible({ timeout: 30_000 }),
  )
})

When('the thread is sent another message', async ({ page }: { page: Page }) => {
  await sendMessage(page, 'Second message of the journey')
})

Then('the model request lists {string} with its folder as an attached reference', async ({ page }: { page: Page }, name: string) => {
  const folder = referenceFolders.get(page)
  if (folder === undefined) throw new Error('No reference folder was created in this scenario.')
  await recordAssertion(page, 'references-runtime-context', () =>
    expect
      .poll(() =>
        fakeCommandCodeFor(page)
          .requests.at(-1)
          ?.messages.some(message => message.text.includes('Attached references:') && message.text.includes(`- ${name}: ${folder}`)),
      )
      .toBe(true),
  )
  await finishJourneyAssertions(page)
})
