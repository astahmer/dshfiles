#!/usr/bin/env node
/**
 * Measures the Agent browser mirror's per-tab cost with the exact work `PreviewBrowsers.frame` does: a viewport JPEG
 * screenshot at quality 55 every 500 ms, hashed, so an unchanged frame sends only its hash.
 *
 * Three windows: idle (browser open, nobody polling), still page (polling, hash-only frames), animated CSS spinner
 * (polling, every frame differs). Prints calls, frames, bytes/s and the CPU of this process plus the browser's tree,
 * so a before/after comparison names whether polling the page is the cost.
 *
 * Usage: node mirror-probe.mjs [--seconds 60]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const requireFromCwd = createRequire(`${process.cwd()}/`)
const { chromium } = requireFromCwd('playwright-core')

const seconds = Number(process.argv.includes('--seconds') ? process.argv[process.argv.indexOf('--seconds') + 1] : 60)
const intervalMs = 500
const quality = 55

const spinner = `<style>
html,body{margin:0;height:100%;background:#101418;display:grid;place-items:center}
.spin{width:180px;height:180px;border-radius:50%;border:18px solid #1f2937;border-top-color:#38bdf8;animation:turn .8s linear infinite}
@keyframes turn{to{transform:rotate(360deg)}}
</style><div class="spin"></div><p style="color:#e5e7eb;font:16px system-ui">animated fixture</p>`

const still = `<style>html,body{margin:0;height:100%;background:#101418;display:grid;place-items:center;color:#e5e7eb;font:16px system-ui}</style><p>static fixture</p>`

const dense = `<style>
html,body{margin:0;background:#0b1020;color:#dbe4ff;font:14px/1.4 system-ui}
main{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:16px}
article{background:#151c33;border:1px solid #263257;border-radius:10px;padding:10px}
h2{margin:0 0 6px;font-size:13px;color:#93c5fd}
p{margin:0;color:#aab4d4}
b{display:block;height:8px;margin-top:8px;border-radius:4px;background:linear-gradient(90deg,#38bdf8,#a78bfa);animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{transform:scaleX(.86)}}
</style><main>${Array.from({ length: 24 }, (_, index) => `<article><h2>Card ${index + 1}</h2><p>Dense text block with enough glyphs to stop JPEG from flattening the frame, repeated per card.</p><b style="width:${40 + (index % 5) * 12}%"></b></article>`).join('')}</main>`

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  const path = request.url ?? '/'
  response.end(path.startsWith('/animated') ? spinner : path.startsWith('/dense') ? dense : still)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const browser = await chromium.launch({ headless: true, timeout: 30_000 })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const descendants = root => {
  const rows = execFileSync('ps', ['-Ao', 'pid,ppid'], { encoding: 'utf8' }).trim().split('\n').slice(1)
  const children = new Map()
  for (const row of rows) {
    const [pid, ppid] = row.trim().split(/\s+/).map(Number)
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  const found = []
  const walk = pid => {
    for (const child of children.get(pid) ?? []) {
      found.push(child)
      walk(child)
    }
  }
  walk(root)
  return found
}

const browserRoot = () => {
  const rows = execFileSync('ps', ['-Ao', 'pid,ppid,command'], { encoding: 'utf8' }).trim().split('\n').slice(1)
  const mine = new Set([process.pid, ...descendants(process.pid)])
  const match = rows.find(row => {
    const [pid, , ...command] = row.trim().split(/\s+/)
    return mine.has(Number(pid)) && /headless_shell|Chromium|Google Chrome/.test(command.join(' '))
  })
  return Number(match?.trim().split(/\s+/, 1)[0] ?? process.pid)
}

const cpuSeconds = pids => {
  const rows = execFileSync('ps', ['-Ao', 'pid,time'], { encoding: 'utf8' }).trim().split('\n').slice(1)
  const timeOf = new Map(
    rows.map(row => {
      const [pid, time] = row.trim().split(/\s+/)
      const parts = time.split(':').map(Number)
      const [hours, minutes, secs] = parts.length === 3 ? parts : [0, parts[0], parts[1]]
      return [Number(pid), hours * 3600 + minutes * 60 + secs]
    }),
  )
  return pids.reduce((sum, pid) => sum + (timeOf.get(pid) ?? 0), 0)
}

const browserPid = browserRoot()
const browserTree = () => [browserPid, ...descendants(browserPid)]

const window = async (label, url, poll) => {
  await page.goto(`http://127.0.0.1:${port}${url}`)
  await page.waitForTimeout(1000)
  const nodeBefore = process.cpuUsage()
  const treeBefore = cpuSeconds(browserTree())
  const startedAt = Date.now()
  let calls = 0
  let frames = 0
  let bytes = 0
  let knownHash
  while (Date.now() - startedAt < seconds * 1000) {
    if (poll) {
      const image = await page.screenshot({ type: 'jpeg', quality, timeout: 8000 })
      const hash = createHash('sha1').update(image).digest('hex')
      calls += 1
      if (hash !== knownHash) {
        frames += 1
        bytes += image.length
      }
      knownHash = hash
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  const elapsed = (Date.now() - startedAt) / 1000
  const nodeUsage = process.cpuUsage(nodeBefore)
  const nodeCpu = (nodeUsage.user + nodeUsage.system) / 1e6
  const browserCpu = cpuSeconds(browserTree()) - treeBefore
  return {
    window: label,
    seconds: Number(elapsed.toFixed(1)),
    calls,
    frames,
    kBps: Number((bytes / 1000 / elapsed).toFixed(1)),
    nodeCpuPercent: Number(((nodeCpu / elapsed) * 100).toFixed(1)),
    browserCpuPercent: Number(((browserCpu / elapsed) * 100).toFixed(1)),
    browserPids: browserTree().length,
  }
}

const rows = []
const only = process.env.ONLY ?? ''
const windows = [
  ['idle', '/still', false],
  ['still-poll', '/still', true],
  ['animated-poll', '/animated', true],
  ['dense-poll', '/dense', true],
]
for (const [label, url, poll] of windows) if (only === '' || only === label) rows.push(await window(label, url, poll))
console.log(JSON.stringify({ seconds, intervalMs, quality, rows }, null, 2))

await browser.close()
server.close()
