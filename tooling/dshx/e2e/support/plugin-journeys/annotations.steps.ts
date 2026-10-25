import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { expect, type Page } from '@playwright/test'
import { bootComposedPluginProfile } from '../boot.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { Then, When, Given } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

const COMPOSER = 'Describe what you want to build, / commands, @ files or sessions'
const NOTE_PLACEHOLDER = 'What is wrong or what should change?'

const composer = (page: Page) => page.getByRole('textbox', { name: COMPOSER, exact: true })
const annotateAction = (page: Page) => page.getByRole('button', { name: 'Annotate an element', exact: true })
const noteField = (page: Page) => page.getByRole('textbox', { name: NOTE_PLACEHOLDER, exact: true })

Then('the composer shows the annotate action', async ({ page }: { page: Page }) => {
  await expect(annotateAction(page)).toBeVisible({ timeout: 30_000 })
})

When('the element picker starts and the composer is picked', async ({ page }: { page: Page }) => {
  await annotateAction(page).click()
  await page.getByRole('button', { name: 'Pick element', exact: true }).click()
  await expect(page.getByText('Click an element', { exact: false }).first()).toBeVisible()
  // Picking the plugin's own action proves the capture path end to end, and its class hash
  // is one the Host can resolve through this package's client source map.
  await annotateAction(page).click()
  await expect(noteField(page))
    .toBeVisible({ timeout: 5_000 })
    .catch(async error => {
      const dump = await page.evaluate(() => Reflect.get(globalThis, 'dshAnnotationsDebug'))
      throw new Error(`${error instanceof Error ? error.message : String(error)} | debug=${JSON.stringify(dump)}`)
    })
})

Then('the comment form describes the picked element', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-comment-form-target', async () => {
    await expect(noteField(page)).toBeFocused()
    await expect(page.getByText(/textbox|div|textarea|form/, { exact: false }).first()).toBeVisible()
  })
})

When('the annotation note {string} is added', async ({ page }: { page: Page }, note: string) => {
  await noteField(page).fill(note)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(noteField(page)).toHaveCount(0)
})

Then('the annotation is listed with the note {string}', async ({ page }: { page: Page }, note: string) => {
  await recordAssertion(page, 'annotations-list-row', async () => {
    await annotateAction(page).click()
    await expect(page.getByText(note, { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  })
})

Then('the annotation is linked to its source file', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-source-line', async () => {
    await expect(page.getByText(/plugins\/\@dshfiles\/annotations\/src\/.*\.tsx:\d+/, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    })
  })
  await finishJourneyAssertions(page)
})

When('the annotations are added to the draft', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /^Add( \d+)? to draft$/ }).click()
})

Then('the composer draft holds the annotation block', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-draft-block', async () => {
    const draft = await composer(page).innerText()
    expect(draft).toContain('Annotated UI feedback (1)')
    expect(draft).toContain('note: the tab strip overlaps the sidebar')
  })
  await finishJourneyAssertions(page)
})

const FIXTURE = 'tooling/dshx/e2e/fixtures/annotations/sample.html'

/** The extension id is derived from its committed key, so the test trusts the same origin the Host does. */
const extensionOrigin = (): string => {
  const manifest = JSON.parse(readFileSync(join(DSHFILES_ROOT, 'plugins/@dshfiles/annotations/extension/manifest.json'), 'utf8')) as { readonly key: string }
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  const id = Array.from(digest, character => String.fromCharCode(97 + Number.parseInt(character, 16))).join('')
  return `chrome-extension://${id}`
}

let ingestToken = ''

When('the HTML preview dialog opens the fixture page', async ({ page }: { page: Page }) => {
  await annotateAction(page).click()
  await page.getByRole('button', { name: 'Preview HTML', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'docs/example.html', exact: true }).fill(FIXTURE)
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
})

Then('the annotated preview shows the fixture page', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-preview-rendered', async () => {
    const frame = page.frameLocator('iframe[title^="Preview of"]')
    await expect(frame.getByRole('heading', { name: 'Preview fixture', exact: true })).toBeVisible({ timeout: 20_000 })
    // The preview's own scripts are stripped, so its marker never runs.
    expect(await frame.locator('body').evaluate(body => (body as { __fixtureScriptRan?: boolean }).__fixtureScriptRan === undefined)).toBe(true)
  })
})

When('the fixture button is annotated with {string}', async ({ page }: { page: Page }, note: string) => {
  const frame = page.frameLocator('iframe[title^="Preview of"]')
  await frame.getByRole('button', { name: 'Rebase thread', exact: true }).click()
  await noteField(page).fill(note)
  await page.getByRole('button', { name: 'Add annotation', exact: true }).click()
  await expect(noteField(page)).toHaveCount(0)
})

Then('the preview annotation is linked to the fixture file', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-preview-source', async () => {
    await page.keyboard.press('Escape')
    await annotateAction(page).click()
    await expect(page.getByText(/annotations\/sample\.html:1/).first()).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
  })
  await finishJourneyAssertions(page)
})

When('the extension pairs with DSH', async ({ page }: { page: Page }) => {
  await annotateAction(page).click()
  await page.getByText('Browser extension', { exact: true }).click()
  await page.getByRole('button', { name: 'Pair extension', exact: true }).click()
  const origin = new URL(page.url()).origin
  const response = await page.request.post(`${origin}/api/dshfiles-annotations/pair`, {
    headers: { origin: extensionOrigin() },
    data: {},
  })
  expect(response.status()).toBe(200)
  ingestToken = ((await response.json()) as { token: string }).token
  expect(ingestToken.length).toBeGreaterThan(20)
  await expect(page.getByText('Paired ✓', { exact: false })).toBeVisible({ timeout: 15_000 })
})

When('the extension posts an annotation with that token', async ({ page }: { page: Page }) => {
  const origin = new URL(page.url()).origin
  const response = await page.request.post(`${origin}/api/dshfiles-annotations/ingest`, {
    headers: { authorization: `Bearer ${ingestToken}`, origin: extensionOrigin() },
    data: {
      drafts: [
        {
          kind: 'element',
          target: {
            surface: 'external',
            url: 'http://localhost:3000/checkout',
            selector: 'button.cta',
            tag: 'button',
            text: 'Pay',
            rect: { x: 10, y: 20, width: 80, height: 30 },
          },
          note: 'from chrome',
        },
      ],
    },
  })
  expect(response.status()).toBe(202)
})

Then('the panel lists the unassigned extension annotation', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-intake-row', async () => {
    await page.keyboard.press('Escape')
    await annotateAction(page).click()
    await expect(page.getByText('From Chrome', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('from chrome', { exact: false }).first()).toBeVisible()
  })
})

When('the unassigned annotation is added to this thread', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Add to this thread', exact: true }).click()
})

Then('the annotation joins this thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-intake-attached', async () => {
    await expect(page.getByText('from chrome', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('button.cta', { exact: false }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const CHROME_FIXTURE =
  '<!doctype html><html><head><title>Annotations chrome fixture</title></head><body><h1>Chrome fixture</h1><button id="fixture-button" aria-label="Annotate fixture">Annotate fixture</button></body></html>'

let fixtureServer: Server | undefined
let fixtureUrl = ''
let pickerPort = 0

Given('the annotations profile is booted with a headless picker browser', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/annotations'],
    profileLabel: '@dshfiles/annotations+headless-picker',
    hostEnv: { DSH_ANNOTATIONS_CHROME_HEADLESS: '1' },
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('Chrome is launched with the fixture page open', async ({ page }: { page: Page }) => {
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(CHROME_FIXTURE)
  })
  await new Promise<void>(resolve => {
    fixtureServer?.listen(0, '127.0.0.1', () => resolve())
  })
  const address = fixtureServer.address()
  if (address === null || typeof address === 'string') throw new Error('no fixture port')
  fixtureUrl = `http://127.0.0.1:${address.port}/`

  await annotateAction(page).click()
  await page.getByText('Chrome without an extension', { exact: true }).click()
  await page.getByRole('button', { name: 'Launch Chrome', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pick on the active tab', exact: true })).toBeVisible({ timeout: 45_000 })

  const endpoint = await page
    .getByText(/^http:\/\/127\.0\.0\.1:\d+$/)
    .first()
    .innerText()
  pickerPort = Number.parseInt(/:([0-9]+)$/.exec(endpoint.trim())?.[1] ?? '', 10)
  expect(Number.isNaN(pickerPort)).toBe(false)

  const opened = await fetch(`http://127.0.0.1:${pickerPort}/json/new?${encodeURIComponent(fixtureUrl)}`, { method: 'PUT' })
  expect(opened.ok).toBe(true)
  // The default is active-tab mode, so no tab list is rendered; wait for the target itself.
  await fixturePageWs()
})

/** A minimal DevTools-protocol client: the journey drives the page the picker was armed on. */
interface JourneyCdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

const openJourneyCdp = ({ wsUrl }: { readonly wsUrl: string }): Promise<JourneyCdp> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map<number, (value: unknown) => void>()
    let nextId = 1
    socket.onopen = () =>
      resolve({
        send: (method, params) =>
          new Promise(resolved => {
            const id = nextId++
            pending.set(id, resolved)
            socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }))
          }),
        close: () => socket.close(),
      })
    socket.onerror = () => reject(new Error('cdp websocket failed'))
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as { readonly id?: number; readonly result?: unknown }
      if (message.id === undefined) return
      pending.get(message.id)?.(message.result)
      pending.delete(message.id)
    }
  })

const fixturePageWs = async (): Promise<string> => {
  const targets = (await (await fetch(`http://127.0.0.1:${pickerPort}/json/list`)).json()) as ReadonlyArray<{
    readonly type?: string
    readonly url?: string
    readonly webSocketDebuggerUrl?: string
  }>
  const page = targets.find(target => target.type === 'page' && target.url === fixtureUrl)
  if (page?.webSocketDebuggerUrl === undefined) throw new Error('fixture tab is not attached')
  return page.webSocketDebuggerUrl
}

const clickFixtureButton = async ({ cdp }: { readonly cdp: JourneyCdp }): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const armed = (await cdp.send('Runtime.evaluate', {
      expression: 'window.__dshAnnotationPicking === true',
      returnByValue: true,
    })) as { readonly result?: { readonly value?: unknown } }
    if (armed.result?.value === true) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const box = (await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify(document.getElementById("fixture-button").getBoundingClientRect())',
    returnByValue: true,
  })) as { readonly result?: { readonly value?: string } }
  const rect = JSON.parse(box.result?.value ?? '{}') as { x?: number; y?: number; width?: number; height?: number }
  const base = {
    x: Math.round((rect.x ?? 0) + (rect.width ?? 0) / 2),
    y: Math.round((rect.y ?? 0) + (rect.height ?? 0) / 2),
    button: 'left',
    clickCount: 1,
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
}

When('the active tab is picked and the fixture button is clicked with {string}', async ({ page }: { page: Page }, note: string) => {
  const cdp = await openJourneyCdp({ wsUrl: await fixturePageWs() })
  try {
    await page.getByRole('button', { name: 'Pick on the active tab', exact: true }).click()
    await clickFixtureButton({ cdp })
  } finally {
    cdp.close()
  }
  await noteField(page).fill(note)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(noteField(page)).toHaveCount(0)
})

Then('the annotation comes from the Chrome tab with {string}', async ({ page }: { page: Page }, note: string) => {
  await recordAssertion(page, 'annotations-chrome-tab', async () => {
    await page.keyboard.press('Escape')
    await annotateAction(page).click()
    await expect(page.getByText('#fixture-button', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(note, { exact: false }).first()).toBeVisible()
  })
})

When('the picker browser is stopped', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await annotateAction(page).click()
  await page.getByText('Chrome without an extension', { exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await new Promise<void>(resolve => {
    if (fixtureServer === undefined) return resolve()
    fixtureServer.close(() => resolve())
  })
  fixtureServer = undefined
})

Then('the picker browser is gone', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'annotations-chrome-stopped', async () => {
    await expect(page.getByText('not running', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})
