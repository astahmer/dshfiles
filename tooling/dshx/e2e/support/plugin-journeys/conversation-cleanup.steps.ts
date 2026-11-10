import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import * as jsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import {
  finishJourneyAssertions,
  openSettingsDialog,
  profileFor,
  recordAssertion,
  settingsNavEntry,
  settingsPage,
  visitIsolatedPluginProfile,
} from '../steps.js'

const sessionIds = ['session-cleanup-archived-one', 'session-cleanup-archived-two']
const sessionRootName = 'conversation-cleanup-sessions'
const storageRootName = 'conversation-cleanup-storage'
const confirmationTitle = 'Permanently delete these conversations?'
const originalLogs = new WeakMap<Page, readonly { readonly path: string; readonly contents: string }[]>()

const cleanupPatch = `- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('${sessionRootName}')
    compression: none
- id: storage-json
  config:
    root: !!js dshHomePath('${storageRootName}')
`

const seedCleanupHome = async (homeRoot: string): Promise<void> => {
  const context = new Context()
  try {
    await context.plugin(jsonlPersistence, { root: join(homeRoot, sessionRootName), compression: 'none' })
    for (const sessionId of sessionIds) {
      const handle = await context.sessionPersistence.create({
        version: SESSION_FORMAT_VERSION,
        id: SessionId(sessionId),
        createdAt: 1_700_000_000_000,
        isSeeded: false,
      })
      try {
        await handle.flush()
      } finally {
        await handle.close()
      }
    }
  } finally {
    await context.fiber.dispose()
  }
  const storageRoot = join(homeRoot, storageRootName)
  await mkdir(storageRoot, { recursive: true })
  await writeFile(
    join(storageRoot, 'workspace.json'),
    `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [], archivedSessionIds: sessionIds, pinnedSessionIds: [] },
      tables: { workspaces: {} },
    })}\n`,
  )
}

const sessionDirectory = (homeRoot: string, sessionId: string): string => join(homeRoot, sessionRootName, '_no-cwd', sessionId)
const cleanupSection = (page: Page) =>
  settingsPage(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Conversation cleanup', exact: true }) })

Given('the isolated conversation-cleanup profile has two cold archived conversations', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/conversation-cleanup'],
    profileLabel: 'conversation-cleanup',
    cordisPatch: cleanupPatch,
    seedHome: seedCleanupHome,
  })
  await visitIsolatedPluginProfile(page, profile)
  originalLogs.set(
    page,
    await Promise.all(
      sessionIds.map(async sessionId => {
        const directory = sessionDirectory(profile.homeRoot, sessionId)
        const names = (await readdir(directory)).filter(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/u.test(name))
        expect(names).toEqual(['session.v4.jsonl'])
        const path = join(directory, 'session.v4.jsonl')
        return { path, contents: await readFile(path, 'utf8') }
      }),
    ),
  )
})

When('the conversation cleanup settings are opened', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await settingsNavEntry(page, 'Conversation cleanup').click()
  await expect(cleanupSection(page)).toBeVisible()
  await expect(cleanupSection(page).getByRole('button', { name: 'Delete previewed conversations', exact: true })).toBeDisabled()
})

When('the conversation cleanup preview is requested', async ({ page }: { page: Page }) => {
  await cleanupSection(page).getByRole('button', { name: 'Preview cleanup', exact: true }).click()
})

Then('both archived conversations appear in the cleanup preview', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'conversation-cleanup-preview-lists-cold-archived-logs', async () => {
    await expect(cleanupSection(page).getByText('Conversations to delete: 2', { exact: true })).toBeVisible()
    for (const sessionId of sessionIds) {
      const candidate = cleanupSection(page).getByRole('listitem').filter({ hasText: sessionId })
      await expect(candidate).toHaveCount(1)
      await expect(candidate).toContainText('Archived')
    }
    await expect(cleanupSection(page).getByRole('button', { name: 'Delete previewed conversations', exact: true })).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath('conversation-cleanup.png') })
  })
})

When('conversation cleanup deletion is cancelled', async ({ page }: { page: Page }) => {
  await cleanupSection(page).getByRole('button', { name: 'Delete previewed conversations', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: confirmationTitle, exact: true })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirmation).toBeHidden()
})

Then('both conversation logs remain unchanged on disk', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'conversation-cleanup-cancel-preserves-persistence', async () => {
    const logs = originalLogs.get(page)
    if (logs === undefined) throw new Error('Seeded conversation logs were not recorded; run the cleanup Given step first.')
    expect(logs).toHaveLength(2)
    for (const log of logs) expect(await readFile(log.path, 'utf8')).toBe(log.contents)
    await expect(cleanupSection(page).getByText('Conversations to delete: 2', { exact: true })).toBeVisible()
  })
})

When('conversation cleanup deletion is confirmed', async ({ page }: { page: Page }) => {
  await cleanupSection(page).getByRole('button', { name: 'Delete previewed conversations', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: confirmationTitle, exact: true })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Permanently delete', exact: true }).click()
  await expect(confirmation).toBeHidden()
})

Then('both conversation log generations are deleted from disk', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'conversation-cleanup-confirm-deletes-persistence', async () => {
    await expect(cleanupSection(page).getByRole('heading', { name: 'Deletion results', exact: true })).toBeVisible()
    for (const sessionId of sessionIds) {
      const result = cleanupSection(page).getByRole('listitem').filter({ hasText: sessionId })
      await expect(result).toHaveCount(1)
      await expect(result).toContainText('Deleted')
      const directory = sessionDirectory(profileFor(page).homeRoot, sessionId)
      expect((await readdir(directory)).filter(name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/u.test(name))).toEqual([])
    }
  })
})

Then('the cleanup preview is empty and deletion is disabled', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'conversation-cleanup-next-preview-is-empty', async () => {
    await expect(cleanupSection(page).getByText('Conversations to delete: 0', { exact: true })).toBeVisible()
    await expect(cleanupSection(page).getByText('No eligible conversations in this preview.', { exact: true })).toBeVisible()
    await expect(cleanupSection(page).getByRole('listitem')).toHaveCount(0)
    await expect(cleanupSection(page).getByRole('button', { name: 'Delete previewed conversations', exact: true })).toBeDisabled()
  })
  await finishJourneyAssertions(page)
})
