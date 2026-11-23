import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { chromium, webkit, devices } from 'playwright'
import { transformWithOxc } from 'vite'

const htmlCsp =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; img-src 'self' data: blob:"
const assets = new Map()
const transfers = []
const failures = []
await mkdir('save-proof', { recursive: true })
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.ts': 'text/plain', '.json': 'application/json' }
for (const name of ['index.html', 'bench.mjs']) {
  const raw = await readFile(name)
  assets.set(`/${name}`, { raw, gzip: gzipSync(raw, { level: 9 }), type: mime[name.slice(name.lastIndexOf('.'))] })
}
const engines = process.env.MODES.split(',')
const full = engines.includes('modern-full')
const allowed = new Set([
  '/dist/current.js',
  '/fixture/src/sample.ts',
  '/fixture/src/second.ts',
  '/modern/index.mjs',
  '/modern/core.mjs',
  '/modern/shiki.mjs',
  '/modern/shiki-wasm.mjs',
  '/modern/workspace.mjs',
  '/modern/util.mjs',
  '/modern/cache.mjs',
  '/modern/editor-core.mjs',
  '/modern/editor-worker.mjs',
  '/modern/editor-worker-main.mjs',
  '/modern/lsp/index.mjs',
  '/modern/lsp/client.mjs',
  '/modern/lsp/typescript/setup.mjs',
  '/modern/lsp/typescript/worker.mjs',
  '/modern/lsp/typescript/libs.mjs',
  '/tslib/typescript.js',
  '/themes/vitesse-dark.json',
  ...['html', 'css', 'typescript'].map(name => `/tm-grammars@1.31.15/grammars/${name}.json`),
])
const roots = [
  ['dist', '/dist'],
  ['fixture', '/fixture'],
  ['node_modules/modern-monaco/dist', '/modern'],
  ['node_modules/tm-grammars/grammars', '/tm-grammars@1.31.15/grammars'],
  ['node_modules/tm-themes/themes', '/themes'],
  ...(full ? [['ts-dist', '/tslib']] : []),
]
async function tree(root, prefix) {
  for (const d of await readdir(root, { withFileTypes: true })) {
    if (d.name.endsWith('.map')) continue
    const filename = `${root}/${d.name}`,
      url = `${prefix}/${d.name}`
    if (d.isDirectory()) {
      await tree(filename, url)
      continue
    }
    const ext = d.name.slice(d.name.lastIndexOf('.'))
    const type = mime[ext]
    if (!type) continue
    if (!allowed.has(url)) continue
    let raw = await readFile(filename)
    if (prefix.startsWith('/modern') && ext === '.mjs') {
      let js = raw.toString()
      if (full && url === '/modern/lsp/typescript/worker.mjs') {
        assert(js.includes('from "typescript"'), 'Expected the pinned worker import.')
        js = js.replace('from "typescript"', 'from "/tslib/typescript.js"')
      }
      raw = Buffer.from((await transformWithOxc(js, filename, { minify: true, target: 'es2024' })).code)
    }
    const gzip = gzipSync(raw, { level: 9 })
    assets.set(url, { raw, gzip, type })
  }
}
for (const [root, prefix] of roots) await tree(root, prefix)
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname === '/' ? '/index.html' : url.pathname
  if (/^\/save\/(sample|second)\.ts$/.test(path) && req.method === 'POST') {
    if (req.headers.origin !== origin) {
      res.writeHead(403).end()
      return
    }
    let text = ''
    for await (const chunk of req) {
      text += chunk
      if (text.length > 65_536) {
        res.writeHead(413).end()
        return
      }
    }
    if (!process.env.RED) await writeFile(`save-proof/${path.split('/').at(-1)}`, text)
    res.writeHead(204).end()
    return
  }
  if (path === '/favicon.ico') {
    res.writeHead(204).end()
    return
  }
  const asset = assets.get(path)
  if (!asset) {
    failures.push(path)
    res.writeHead(404).end()
    return
  }
  const { raw, gzip, type } = asset
  transfers.push({ path, raw: raw.length, gzip: gzip.length })
  res
    .writeHead(200, {
      'Content-Type': type,
      'Content-Length': gzip.length,
      'Content-Encoding': 'gzip',
      'Cache-Control': path === '/index.html' ? 'no-store' : 'public,max-age=3600,immutable',
      'Content-Security-Policy': htmlCsp,
    })
    .end(gzip)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const ms = (a, b) => (a === undefined ? null : Math.round(a - b))
const classify = xs => ({ requests: xs.length, gzip: xs.reduce((a, b) => a + b.gzip, 0), raw: xs.reduce((a, b) => a + b.raw, 0), assets: xs.map(x => x.path) })
const errorKind = message =>
  /^Canceled(?:: Canceled)?$/.test(message) ? 'Canceled' : message.includes('Model is disposed!') ? 'Model is disposed!' : 'Other browser error'
let browser
try {
  const phone = process.env.PHONE === '1'
  browser = await (phone ? webkit : chromium).launch({
    ...(phone ? {} : { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] }),
  })
  console.log('browser', browser.version(), phone ? '390×844 WebKit touch context' : 'Chromium desktop')
  for (let i = 0; i < Number(process.env.RUNS ?? 3); i++)
    for (const mode of [...engines.slice(i % engines.length), ...engines.slice(0, i % engines.length)]) {
      const context = await browser.newContext(
        phone ? { ...devices['iPhone 12'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1280, height: 820 } },
      )
      const errors = []
      const external = new Set()
      const page = await context.newPage()
      page.setDefaultTimeout(7500)
      page.on('request', r => {
        if (!r.url().startsWith(`${origin}/`) && !/^(blob|data):/.test(r.url())) external.add('non-loopback request')
      })
      page.on('pageerror', e => errors.push(errorKind(e.message)))
      page.on('console', m => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(errorKind(m.text()))
      })
      try {
        for (const cache of ['cold', 'warm']) {
          let step = 'open'
          try {
            errors.length = 0
            await writeFile('save-proof/sample.ts', 'not yet saved')
            let from = transfers.length
            await page.goto(`${origin}/?mode=${mode}`)
            const shell = classify(transfers.slice(from))
            from = transfers.length
            if (phone) await page.locator('#first').tap()
            else {
              await page.locator('#first').focus()
              await page.keyboard.press('Enter')
            }
            await page.waitForFunction(() => globalThis.marks?.focus !== undefined)
            step = 'exact first edit'
            await page.keyboard.type('Z')
            await page.waitForFunction(() => check.get() === `Z${check.original()}`)
            await page.waitForFunction(() => !!marks.highlighted)
            await page.waitForLoadState('networkidle')
            const open = classify(transfers.slice(from))
            const openErrors = errors.slice()
            const marks = await page.evaluate(() => globalThis.marks)
            step = 'undo, line reveal and save'
            const key = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
            await page.keyboard.press(`${key}+z`)
            await page.waitForFunction(() => check.get() === check.original())
            await page.locator('#reveal').focus()
            await page.keyboard.press('Enter')
            await page.keyboard.type('Z')
            const atLine = await page.evaluate(() => check.get().split('\n')[39] === `Z${check.original().split('\n')[39]}`)
            assert(atLine, 'source reveal selects the expected line')
            const value = await page.evaluate(() => check.get())
            if (phone) await page.locator('#save').tap()
            else await page.keyboard.press(`${key}+s`)
            await page.waitForFunction(() => check.saved() === true)
            assert((await readFile('save-proof/sample.ts', 'utf8')) === value, 'save must deliver the exact edited synthetic file, not just report success')
            await page.locator('#second').focus()
            await page.keyboard.press('Enter')
            await page.waitForFunction(() => check.get()?.startsWith('// synthetic second file'))
            assert.deepEqual([...external], [], 'no non-loopback requests')
            assert.deepEqual(failures, [], 'no missing asset routes')
            assert.deepEqual(
              errors.filter(e => !/^Canceled(?:: Canceled)?$/.test(e)),
              [],
              'no unexpected browser errors',
            )
            console.log(
              JSON.stringify({
                i,
                mode,
                cache,
                shellMs: ms(marks.shell, 0),
                sourceDomMs: ms(marks.sourceDom, marks.opened),
                focusMs: ms(marks.focus, marks.opened),
                typedMs: ms(marks.accepted, marks.opened),
                highlightedMs: ms(marks.highlighted, marks.opened),
                shell,
                open,
                external: [...external],
                errors,
                openErrors,
                undoSaveRevealSwitch: 'pass',
              }),
            )
          } catch (error) {
            if (!phone) throw error
            console.log(JSON.stringify({ i, mode, cache, step, errors, external: [...external], outcome: 'failed' }))
            process.exitCode = 1
          }
        }
      } finally {
        await context.close()
      }
    }
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(r => server.close(r))
}
