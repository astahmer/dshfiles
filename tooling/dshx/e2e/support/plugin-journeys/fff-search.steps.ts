import { expect, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

const fixtureLine = 'fff-search-e2e-match'
const commandCodeModel = 'commandcode_work/gpt-6-luna'
const threadComposerName = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/

When('the fake model calls resident grep and glob on the workspace', async ({ page }: { page: Page }) => {
  const project = join(await createScratchDirectory('dshx-fff-search-e2e-'), 'fff-search-project')
  await mkdir(project)
  await writeFile(join(project, 'README.md'), `${fixtureLine}\n`)
  await registerWorkspaceFolder(page, project)
  await startThreadWithModel(page, { project: 'fff-search-project', model: commandCodeModel })
  await sendMessage(
    page,
    `[[call grep ${JSON.stringify({ pattern: fixtureLine, path: 'README.md' })}]][[call glob ${JSON.stringify({ pattern: 'README.md', path: '.' })}]]`,
  )
  await expect(page.getByRole('textbox', { name: threadComposerName })).toBeVisible()
})

Then('the real grep and glob tool results contain the fixture', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'fff-search-agent-grep-and-glob', async () => {
    await expect
      .poll(() => {
        const lastTurn = fakeCommandCodeFor(page)
          .requests.filter(request => request.kind === 'turn')
          .at(-1)
        return lastTurn?.messages.filter(message => message.role === 'tool').map(message => message.text) ?? []
      })
      .toHaveLength(2)
    const lastTurn = fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .at(-1)
    const results = lastTurn?.messages.filter(message => message.role === 'tool').map(message => message.text) ?? []
    expect(results.some(result => result.includes(fixtureLine) && result.includes('README.md'))).toBe(true)
    expect(results.some(result => result.includes('README.md') && !result.includes(fixtureLine))).toBe(true)
  })
  await finishJourneyAssertions(page)
})
