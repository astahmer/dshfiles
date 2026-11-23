import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { StartupDialogs } from '../../packages/dshx/dist/project/startup-dialogs.js'
import { largeThreadMarker, scratchFixture, shortThreadA, viewport } from './fixtures.ts'
import { selectProject } from './select-project.mjs'

const { launchUrl, stateDir, projectName } = scratchFixture()
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport })

let stage = 'opening scratch DSH'
try {
  await StartupDialogs.markSetupWizardSkipped(page)
  await page.goto(launchUrl)
  await StartupDialogs.dismissPreviewNotice(page)
  await StartupDialogs.registerPreviewNoticeDismissal(page)
  await StartupDialogs.dismissProviderSetupDuringStartup(page)

  const newThread = page.getByRole('button', { name: 'New thread', exact: true }).filter({ visible: true }).first()
  stage = 'selecting the sample project'
  await selectProject(page, projectName)

  const seedThread = async (label, message) => {
    stage = `opening ${label}`
    const previousId = new URL(page.url()).searchParams.get('thread')
    await newThread.click()
    const composer = await selectProject(page, projectName)
    await StartupDialogs.dismissProviderSetupIfShown(page)
    stage = `sending the ${label} prompt`
    await composer.fill(message)
    await composer.press('Enter')
    stage = `waiting for the ${label} history`
    await page.waitForFunction(before => {
      const id = new URL(window.location.href).searchParams.get('thread')
      return (
        id !== null &&
        id !== before &&
        Array.from(document.querySelectorAll('[data-thread-main-action]')).some(row => row.getAttribute('data-thread-id') === id)
      )
    }, previousId)
    const id = new URL(page.url()).searchParams.get('thread')
    const history = page.locator(`[data-conversation-session=${JSON.stringify(id)}] [data-chat-flow]`).filter({ hasText: message.slice(0, 90) })
    await history.first().waitFor({ state: 'visible' })
    return id
  }

  const ids = {
    a: await seedThread('first short Session', shortThreadA),
    b: await seedThread('second short Session', 'Strobe benchmark B'),
    large: await seedThread(
      'large Session',
      `Strobe benchmark large history\n\n${largeThreadMarker}\n\n${'synthetic scratch-only history content '.repeat(13_000)}`,
    ),
  }
  stage = 'saving fixture IDs'
  await writeFile(join(stateDir, 'strobe-bench-fixtures.json'), JSON.stringify(ids), { mode: 0o600 })
  process.stdout.write('Seeded three scratch-only Sessions; large prompt is approximately 500 KB.\n')
} catch {
  // Playwright navigation errors can contain the authenticated launch URL.
  throw new Error(`Stopped while ${stage}. Check dshx dev doctor --name strobe-bench and retry on a fresh scratch instance.`)
} finally {
  await browser.close()
}
