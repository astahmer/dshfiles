// SCRATCH ONLY: count the dshx registry and Workbench panel registry churn that thread switches cause. It opens each
// thread of IDS through its `?thread=` URL (history push, no reload, like a sidebar click), then prints how often each
// dshx registry notified its listeners and how long those listeners (the consumers' reruns) took, which entries were
// written (owner and item id, uuids folded to `*`), how often the Workbench panel registry changed and which
// definitions it replaced, and the page's script and task time (CDP Performance metrics) over the switches. An
// unchanged palette, slot or panel list should write nothing on a switch.
// Usage: LAUNCH_URL=<scratch launch url> IDS=<file of thread ids, one per line> node registry-churn-probe.mjs [switches=10]
//   env: DWELL_MS=<ms per thread, default 2500>, TOP=<rows per table, default 40>, JSON=1 prints one JSON object.
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../../../../tooling/dshx/package.json', import.meta.url)))
const { chromium } = require('@playwright/test')
const url = process.env.LAUNCH_URL
const liveUrlFile = `${process.env.HOME}/.dsh/runtime/web-url`
if (url === undefined) throw new Error('Set LAUNCH_URL to a scratch DSH launch URL (dshx dev up writes it to its state.json).')
if (existsSync(liveUrlFile) && new URL(readFileSync(liveUrlFile, 'utf8').trim()).origin === new URL(url).origin) {
  throw new Error('Refusing the live DSH: this probe patches page registries. Point LAUNCH_URL at a scratch instance.')
}
if (process.env.IDS === undefined) throw new Error('Set IDS to a file of thread ids to switch between, one per line.')
const ids = readFileSync(process.env.IDS, 'utf8').split('\n').filter(Boolean)
const switches = Number(process.argv[2] ?? 10)
const dwell = Number(process.env.DWELL_MS ?? 2500)
const top = Number(process.env.TOP ?? 40)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addLocatorHandler(page.getByRole('dialog', { name: /^(Add an API key to get started|Get started|Preview Notice)$/ }), async dialog => {
  for (const name of ['Continue', 'Configure later', 'Close']) {
    const button = dialog.getByRole('button', { name, exact: true })
    if (await button.isVisible().catch(() => false)) return button.click()
  }
  await page.keyboard.press('Escape')
})
await page.goto(url)
await page.locator('[data-thread-main-action]').first().waitFor({ timeout: 90_000 })
await page.waitForTimeout(6000)
await page.evaluate(() => {
  const counts = { registries: {}, listenerMs: {}, contracts: {}, writes: {}, workbench: { notifies: 0, replaced: {} } }
  globalThis.__registryChurn = counts
  const bump = (table, key) => {
    table[key] = (table[key] ?? 0) + 1
  }
  const broker = globalThis.__dshxBrokerV1
  // Time every listener of a registry (the consumers' rerun on each change), keeping add/delete by original function.
  const timed = (id, listeners) => {
    const wrappers = new Map()
    const wrap = listener => {
      const wrapper = (...args) => {
        const started = performance.now()
        try {
          return listener(...args)
        } finally {
          counts.listenerMs[id] = (counts.listenerMs[id] ?? 0) + performance.now() - started
        }
      }
      wrappers.set(listener, wrapper)
      return wrapper
    }
    const originals = [...listeners]
    listeners.clear()
    const { add, delete: remove, has } = Set.prototype
    for (const listener of originals) add.call(listeners, wrap(listener))
    listeners.add = function (listener) {
      if (wrappers.has(listener)) return this
      return add.call(this, wrap(listener))
    }
    listeners.delete = function (listener) {
      const wrapper = wrappers.get(listener)
      wrappers.delete(listener)
      return remove.call(this, wrapper ?? listener)
    }
    listeners.has = function (listener) {
      return has.call(this, wrappers.get(listener) ?? listener)
    }
  }
  for (const [id, state] of broker?.registries ?? []) {
    timed(id, state.listeners)
    state.listeners.add(() => bump(counts.registries, id))
    const set = state.entries.set
    state.entries.set = function (key, value) {
      bump(counts.writes, `${id} <- ${value.owner} ${String(value.item?.id ?? '').replace(/[0-9a-f-]{20,}/g, '*')}`)
      return set.call(this, key, value)
    }
  }
  for (const [id, state] of broker?.contracts ?? []) state.listeners.add(() => bump(counts.contracts, id))
  const workbench = globalThis.dshfilesWorkbenchPanelsV1
  if (workbench === undefined) return
  let previous = new Map(workbench.list().map(definition => [definition.id, definition]))
  workbench.subscribe(() => {
    counts.workbench.notifies += 1
    const next = new Map(workbench.list().map(definition => [definition.id, definition]))
    for (const [id, definition] of next) if (previous.get(id) !== definition) bump(counts.workbench.replaced, id.replace(/[0-9a-f-]{20,}/g, '*'))
    for (const id of previous.keys()) if (!next.has(id)) bump(counts.workbench.replaced, `-${id.replace(/[0-9a-f-]{20,}/g, '*')}`)
    previous = next
  })
})
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
const start = await metrics()
for (const id of ids.slice(0, switches)) {
  await page.evaluate(id => {
    const next = new URL(location.href)
    next.searchParams.set('thread', id)
    history.pushState(history.state, '', next)
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, id)
  await page.waitForTimeout(dwell)
}
const end = await metrics()
const result = await page.evaluate(() => globalThis.__registryChurn)
await browser.close()
const cpu = { scriptMs: Math.round((end.ScriptDuration - start.ScriptDuration) * 1000), taskMs: Math.round((end.TaskDuration - start.TaskDuration) * 1000) }

const sorted = table => Object.entries(table).sort((left, right) => right[1] - left[1])
const total = table => Object.values(table).reduce((sum, count) => sum + count, 0)
if (process.env.JSON === '1') {
  console.log(JSON.stringify({ switches: Math.min(switches, ids.length), cpu, ...result }))
} else {
  console.log(`switches ${Math.min(switches, ids.length)}, page script ${cpu.scriptMs} ms, tasks ${cpu.taskMs} ms (check uptime first)`)
  console.log(`registry notifications ${total(result.registries)}`)
  for (const [id, count] of sorted(result.registries)) console.log(`${String(count).padStart(8)}  ${id}  (listeners ${Math.round(result.listenerMs[id] ?? 0)} ms)`)
  console.log(`contract notifications ${total(result.contracts)}`)
  for (const [id, count] of sorted(result.contracts)) console.log(`${String(count).padStart(8)}  ${id}`)
  console.log(`registry entry writes ${total(result.writes)}`)
  for (const [key, count] of sorted(result.writes).slice(0, top)) console.log(`${String(count).padStart(8)}  ${key}`)
  console.log(`workbench panel registry notifications ${result.workbench.notifies}, definitions replaced ${total(result.workbench.replaced)}`)
  for (const [id, count] of sorted(result.workbench.replaced).slice(0, top)) console.log(`${String(count).padStart(8)}  ${id}`)
}
