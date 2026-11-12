#!/usr/bin/env node
/**
 * Measure how installable the running Web UI is: Chromium's own installability
 * errors, the served head tags, and every manifest icon's real decoded size.
 * Reads a scratch `dshx dev` state file, so the tokenized launch URL stays in
 * that file and never reaches stdout.
 *
 *   node scripts/pwa-probe.mjs --name pwa --label before [--json] [--shot <png>]
 */
import { createRequire } from 'node:module'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    label: { type: 'string', default: 'probe' },
    json: { type: 'boolean', default: false },
    shot: { type: 'string' },
    url: { type: 'string' },
    width: { type: 'string', default: '390' },
    height: { type: 'string', default: '844' },
  },
})

const requireFromDshx = createRequire(new URL('../tooling/dshx/packages/dshx/package.json', import.meta.url))
const { chromium } = requireFromDshx('playwright')

const stateRoot = join(tmpdir(), 'dshx-dev')

const stateFileOf = async name => {
  if (name !== undefined) return join(stateRoot, name, 'state.json')
  const names = await readdir(stateRoot).catch(() => [])
  const candidates = await Promise.all(
    names.map(async entry => {
      const file = join(stateRoot, entry, 'state.json')
      const text = await readFile(file, 'utf8').catch(() => undefined)
      if (text === undefined) return undefined
      return { file, createdAt: JSON.parse(text).createdAt ?? '' }
    }),
  )
  const newest = candidates.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (newest === undefined) throw new Error(`No scratch state under ${stateRoot}. Run "dshx dev up" first.`)
  return newest.file
}

const readState = async () => {
  const file = await stateFileOf(values.name)
  return JSON.parse(await readFile(file, 'utf8'))
}

const state = values.url === undefined ? await readState() : { launchUrl: values.url, browser: { cdpPort: 0 } }
const browser =
  state.browser.cdpPort === 0 ? await chromium.launch({ headless: true }) : await chromium.connectOverCDP(`http://127.0.0.1:${state.browser.cdpPort}`)
const context = browser.contexts()[0] ?? (await browser.newContext())
const page = context.pages()[0] ?? (await context.newPage())

await page.setViewportSize({ width: Number(values.width), height: Number(values.height) })
await page.goto(state.launchUrl, { waitUntil: 'load', timeout: 60_000 })
await page.waitForTimeout(1_500)

const session = await context.newCDPSession(page)
await session.send('Page.enable')
const installability = await session.send('Page.getInstallabilityErrors')
const appManifest = await session.send('Page.getAppManifest').catch(error => ({ error: String(error).slice(0, 200) }))
await session.detach()

const head = await page.evaluate(() => {
  const attr = (element, name) => element.getAttribute(name) ?? ''
  const links = selector =>
    [...document.querySelectorAll(selector)].map(element => ({
      rel: attr(element, 'rel'),
      href: attr(element, 'href'),
      sizes: attr(element, 'sizes'),
      type: attr(element, 'type'),
    }))
  return {
    title: document.title,
    manifestHrefs: links('link[rel="manifest"]').map(link => link.href),
    appleTouchIcons: links('link[rel="apple-touch-icon"],link[rel="apple-touch-icon-precomposed"]'),
    appleCapable: link_apple('apple-mobile-web-app-capable'),
    appleStatusBar: link_apple('apple-mobile-web-app-status-bar-style'),
    appleTitle: link_apple('apple-mobile-web-app-title'),
    themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map(element => attr(element, 'content')),
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
    displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
  }
  function link_apple(name) {
    return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? ''
  }
})

const audit = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href')
  if (href === undefined || href === null) return { manifest: undefined, icons: [] }
  const url = new URL(href, location.href).href
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return { manifest: { status: response.status }, icons: [] }
  const text = await response.text()
  const manifest = JSON.parse(text)
  const icons = []
  for (const icon of manifest.icons ?? []) {
    const iconUrl = new URL(icon.src, url).href
    const iconResponse = await fetch(iconUrl, { cache: 'no-store' }).catch(() => undefined)
    let decoded = undefined
    if (iconResponse?.ok === true) {
      const blob = await iconResponse.blob()
      decoded = await createImageBitmap(blob)
        .then(bitmap => ({ width: bitmap.width, height: bitmap.height }))
        .catch(() => undefined)
    }
    icons.push({
      src: new URL(iconUrl).pathname,
      declaredSizes: icon.sizes ?? '',
      type: icon.type ?? '',
      purpose: icon.purpose ?? 'any',
      status: iconResponse?.status ?? 0,
      contentType: iconResponse?.headers.get('content-type') ?? '',
      decoded,
    })
  }
  return {
    manifest: {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      fields: {
        name: manifest.name ?? '',
        shortName: manifest.short_name ?? '',
        startUrl: manifest.start_url ?? '',
        scope: manifest.scope ?? '',
        display: manifest.display ?? '',
        id: manifest.id ?? '',
        themeColor: manifest.theme_color ?? '',
        backgroundColor: manifest.background_color ?? '',
        iconCount: (manifest.icons ?? []).length,
      },
    },
    icons,
  }
})

if (values.shot !== undefined) await page.screenshot({ path: values.shot })

const summary = {
  label: values.label,
  installabilityErrors: installability.installabilityErrors.map(error => error.errorId),
  manifestErrors: Array.isArray(appManifest.errors) ? appManifest.errors.map(error => error.message) : [],
  manifestParse: appManifest.error ?? 'ok',
  head,
  served: audit,
}
console.log(JSON.stringify(summary, null, 2))
await writeFile(join(tmpdir(), `pwa-probe-${values.label}.json`), JSON.stringify(summary, null, 2)).catch(() => undefined)
if (values.url !== undefined) await browser.close()
// A connected scratch Chromium outlives the probe: closing the CDP connection would stop it.
process.exit(0)
