import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, webkit, devices } from 'playwright'
export async function probeNative({ url, root }) {
  const origin = new URL(url).origin
  const phone = process.env.PHONE === '1'
  const browser = await (phone ? webkit : chromium).launch(
    phone ? {} : { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] },
  )
  try {
    for (let i = 0; i < Number(process.env.RUNS ?? 5); i++) {
      const context = await browser.newContext({
        locale: 'en-US',
        ...(phone ? { ...devices['iPhone 12'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1280, height: 820 } }),
      })
      await context.route(
        target => /^https?:$/.test(target.protocol) && target.origin !== origin,
        r => r.abort(),
      )
      await context.routeWebSocket(
        target => target.host !== new URL(origin).host || target.protocol !== 'ws:',
        ws => ws.close(),
      )
      const page = await context.newPage()
      page.setDefaultTimeout(6000)
      const cdp = phone ? null : await context.newCDPSession(page)
      const errors = []
      const external = []
      page.on('pageerror', e => errors.push(e.name))
      page.on('request', r => {
        if (!r.url().startsWith(`${origin}/`) && !/^(blob|data):/.test(r.url())) external.push(new URL(r.url()).origin)
      })
      let bytes = 0,
        frames = 0
      if (cdp) {
        await cdp.send('Network.enable')
        cdp.on('Network.webSocketFrameReceived', ({ response: { opcode, payloadData } }) => {
          bytes += Buffer.byteLength(payloadData, opcode === 2 ? 'base64' : 'utf8')
          frames++
        })
      }
      const config = page.getByRole('dialog', { name: /Get started|Add an API key/ })
      await page.addLocatorHandler(config, async d =>
        d
          .getByRole('button', { name: /^(Close|Configure later)$/ })
          .first()
          .click(),
      )
      const notice = page.getByRole('dialog', { name: 'Preview Notice', exact: true })
      await page.addLocatorHandler(notice, async d => d.getByRole('button', { name: 'Continue', exact: true }).click())
      await page.goto(url)
      const ready = page.getByRole('button', { name: 'Open right sidebar', exact: true })
      await ready.waitFor()
      const setup = await page.evaluate(() => ({
        ms: Math.round(performance.now()),
        response: [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]
          .filter(e => e.name.startsWith(location.origin + '/'))
          .reduce(([count, transfer, body], e) => [count + 1, transfer + e.transferSize, body + e.decodedBodySize], [0, 0, 0]),
      }))
      setup.ws = bytes
      setup.frames = frames
      const startWs = bytes,
        startFrames = frames
      await ready.click()
      const files = page.locator('[data-sidebar-right-guide-entry="files"]')
      await files.click()
      const filesPath = page.locator('[data-files-page] [data-files-path]').first()
      await filesPath.waitFor()
      assert((await filesPath.textContent()) === root, 'fixture root must match')
      const folder = page.getByRole('button', { name: 'src', exact: true })
      await folder.focus()
      await folder.press('Enter')
      const treeWs = bytes - startWs,
        treeFrames = frames - startFrames
      const tab = page.getByRole('tab', { name: /^Files/ })
      for (const [file, marker] of [
        ['sample.ts', '// synthetic fixture'],
        ['second.ts', '// synthetic second file'],
      ]) {
        const openedBytes = bytes,
          openedFrames = frames
        const row = page.getByRole('button', { name: file, exact: true })
        await row.evaluate(el => el.addEventListener('click', () => (globalThis.fileOpen = performance.now()), { once: true, capture: true }))
        if (phone) await row.tap()
        else {
          await row.focus()
          await row.press('Enter')
        }
        const body = page.locator('[data-textpreview-body]:visible')
        await body.locator('code').first().waitFor()
        await page.waitForFunction(
          m => [...document.querySelectorAll('[data-textpreview-body] code')].some(el => el.getClientRects().length && el.textContent.includes(m)),
          marker,
        )
        const phase = await page.evaluate(
          () =>
            new Promise(resolve =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  resolve({
                    ms: Math.round(performance.now() - globalThis.fileOpen),
                    response: performance
                      .getEntriesByType('resource')
                      .filter(e => e.name.startsWith(location.origin + '/') && e.startTime >= globalThis.fileOpen)
                      .map(e => ({ file: new URL(e.name).pathname.split('/').at(-1), transfer: e.transferSize, decoded: e.decodedBodySize })),
                  }),
                ),
              ),
            ),
        )
        const previewWs = bytes - openedBytes,
          previewFrames = frames - openedFrames
        assert.equal(await body.locator(':is(textarea,input,[contenteditable=true])').count(), 0)
        await page.keyboard.type('Z')
        await page.keyboard.press('ControlOrMeta+s')
        assert((await readFile(`${root}/src/${file}`, 'utf8')) === (await readFile(`fixture/src/${file}`, 'utf8')), 'native viewer did not edit the file')
        const toggle = page.locator('[data-files-navigator-toggle]:visible')
        if (file === 'sample.ts') {
          if (phone) await toggle.tap()
          else {
            await toggle.focus()
            await toggle.press('Enter')
          }
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
          const current = page.locator('[data-files-navigator]:visible [aria-current=true]')
          await current.waitFor()
          assert.equal(await current.textContent(), file)
          if (!phone) {
            await current.focus()
            await current.press('Escape')
            assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
          }
        }
        assert.deepEqual(external, [])
        assert.deepEqual(errors, [])
        console.log(JSON.stringify({ i, file, phone, setup, treeWs, treeFrames, phase, previewWs, previewFrames }))
        if (file === 'sample.ts') await tab.click()
      }
      await context.close()
    }
  } catch (e) {
    console.error(e.message.replace(/https?:\/\/[^\s"']+/g, '[scratch URL]'))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}
