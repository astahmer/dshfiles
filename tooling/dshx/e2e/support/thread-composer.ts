import { expect, type Page, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

/** M0 materializes a Host Session only after a real first submit. No step registration or profile side effects. */
export const materializeNonblankThread = async (page: Page, prompt: string, testInfo: TestInfo): Promise<string> => {
  const composer = page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
  if (!(await composer.isVisible())) {
    await page
      .getByRole('button', { name: 'New thread', exact: true })
      .or(page.getByRole('button', { name: 'New session', exact: true }))
      .first()
      .click()
  }
  const chooseWorkspace = page.getByRole('button', { name: 'Choose workspace', exact: true })
  if ((await chooseWorkspace.isVisible()) && (await chooseWorkspace.textContent())?.trim() === 'Choose workspace') {
    await chooseWorkspace.click()
    const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
    await expect(picker).toBeVisible()
    const sample = picker.getByRole('option', { name: /^sample(?:\s|$)/i }).first()
    if (await sample.isVisible()) await sample.click()
    else {
      const workspace = testInfo.outputPath('thread-sidebar-workspace')
      await mkdir(workspace, { recursive: true })
      await picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true }).fill(workspace)
      await picker.getByRole('button', { name: 'Register project', exact: true }).first().click()
    }
    await expect(picker).toBeHidden()
  }
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(send).toBeEnabled()
  await send.click()
  const currentThreadId = (): string | null => new URL(page.url()).searchParams.get('thread')
  await expect.poll(currentThreadId).not.toBeNull()
  const threadId = currentThreadId()
  if (threadId === null) throw new Error('The first submitted message did not materialize a Host thread.')
  await expect(page.locator('[data-slot="conversation.session"]').filter({ visible: true }).getByText(prompt, { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Threads' }).locator(`article[data-thread-id="${threadId}"]`)).toBeVisible()
  return threadId
}
