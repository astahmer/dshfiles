import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateRoot = process.env.DSHX_DEV_STATE_ROOT ?? join(tmpdir(), 'dshx-dev')
const statePath = join(stateRoot, 'strobe-bench', 'state.json')
const state = JSON.parse(await readFile(statePath, 'utf8'))
if (state.name !== 'strobe-bench' || typeof state.launchUrl !== 'string') {
  throw new Error('Expected the isolated strobe-bench scratch instance state.')
}

const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  await page.goto(state.launchUrl)
  const notice = page.getByRole('dialog', { name: 'Preview Notice', exact: true })
  if (await notice.isVisible().catch(() => false)) {
    await notice.getByRole('button', { name: 'Continue', exact: true }).click()
  }
  const setup = page.getByRole('dialog', { name: /^(Add an API key to get started|Get started)$/ })
  if (await setup.isVisible().catch(() => false)) {
    const later = setup.getByRole('button', { name: 'Configure later', exact: true })
    if (await later.isVisible().catch(() => false)) await later.click()
    else await setup.getByRole('button', { name: 'Close', exact: true }).click()
  }

  const seedThread = async message => {
    const previousId = new URL(page.url()).searchParams.get('thread')
    await page.getByRole('button', { name: 'New thread', exact: true }).click()
    await page.waitForFunction(before => {
      const current = new URL(window.location.href).searchParams.get('thread')
      return current !== null && current !== before
    }, previousId)
    const id = new URL(page.url()).searchParams.get('thread')
    if (id === null) throw new Error('New thread did not get a Session id.')
    const composer = page.locator('[contenteditable="true"]').last()
    await composer.waitFor({ state: 'visible' })
    await composer.fill(message)
    await composer.press('Enter')
    await page.locator(`[data-thread-main-action][data-thread-id=${JSON.stringify(id)}]`).waitFor({ state: 'visible' })
    await page.locator(`[data-conversation-session=${JSON.stringify(id)}] [data-chat-flow]`).waitFor({ state: 'visible' })
    return id
  }

  const ids = {
    a: await seedThread('Strobe benchmark A'),
    b: await seedThread('Strobe benchmark B'),
    large: await seedThread(`Strobe benchmark large history\n\nstrobe large history marker\n\n${'synthetic scratch-only history content '.repeat(13_000)}`),
  }
  await writeFile(join(state.stateDir, 'strobe-bench-fixtures.json'), JSON.stringify(ids), { mode: 0o600 })
  process.stdout.write('Seeded three scratch-only sessions; large prompt is approximately 500 KB.\n')
} finally {
  await browser.close()
}
