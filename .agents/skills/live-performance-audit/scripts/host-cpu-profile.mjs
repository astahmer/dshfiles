// Record a V8 CPU profile of a running DSH Host without restarting it, then print where the main thread went.
// Usage: node host-cpu-profile.mjs <host-pid> [seconds=60] [out=host.cpuprofile]
// SIGUSR1 opens the Node inspector on 127.0.0.1:9229; the script closes it again when done.
import { writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const [pid, seconds = '60', out = 'host.cpuprofile'] = process.argv.slice(2)
if (pid === undefined) throw new Error('usage: host-cpu-profile.mjs <host-pid> [seconds] [out]')
process.kill(Number(pid), 'SIGUSR1')
await delay(1000)
const [target] = await (await fetch('http://127.0.0.1:9229/json/list')).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise(resolve => {
    nextId += 1
    pending.set(nextId, resolve)
    socket.send(JSON.stringify({ id: nextId, method, params }))
  })
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  pending.get(message.id)?.(message.result ?? message.error)
  pending.delete(message.id)
}
await new Promise(resolve => (socket.onopen = resolve))
await send('Profiler.enable')
await send('Profiler.setSamplingInterval', { interval: 1000 })
await send('Profiler.start')
await delay(Number(seconds) * 1000)
const { profile } = await send('Profiler.stop')
await send('Runtime.evaluate', { expression: "setTimeout(() => process.getBuiltinModule('node:inspector').close(), 100), 'closing'" })
socket.close()
writeFileSync(out, JSON.stringify(profile))

const byId = new Map(profile.nodes.map(node => [node.id, node]))
const parent = new Map()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
const owner = url => (url.match(/(@dshfiles\/[^/]+|@deepseek-ai\/[^/]+)/g) ?? [url.split('/').pop() || '(native)']).at(-1)
const inclusive = new Map()
let busy = 0
profile.samples.forEach((sample, index) => {
  // The first delta spans the attach, not the sampled frame: on a loaded Host it blamed 5.8 s on a lone DOMException.
  if (index === 0) return
  const delta = profile.timeDeltas[index] ?? 0
  const frame = byId.get(sample).callFrame
  if (frame.functionName === '(idle)' || frame.functionName === '(program)') return
  busy += delta
  const seen = new Set()
  for (let current = sample; current !== undefined; current = parent.get(current)) {
    const callFrame = byId.get(current).callFrame
    const key = `${owner(callFrame.url)} ${callFrame.functionName || '(anonymous)'}:${callFrame.lineNumber + 1}`
    if (seen.has(key)) continue
    seen.add(key)
    inclusive.set(key, (inclusive.get(key) ?? 0) + delta)
  }
})
console.log(`busy ${(busy / 1000).toFixed(0)} ms of ${seconds} s; heaviest DSH/dshfiles frames (inclusive):`)
for (const [key, micros] of [...inclusive]
  .filter(([key]) => /@dshfiles|@deepseek-ai/.test(key))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)) {
  console.log(`${String(Math.round(micros / 1000)).padStart(7)} ms  ${key}`)
}
