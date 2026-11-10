#!/usr/bin/env node
/**
 * Names the caller that pins cold Session reads in a running DSH Host.
 *
 * The observation cache keeps one decoded log per pinned observation, so a burst of cold reads is what drives the
 * Host toward its heap limit. This arms the inspector on `SessionObservationReader.read`, collects the caller stacks
 * for a bounded window and prints them grouped by call path.
 *
 *   node scripts/probe-cold-reads.mjs [seconds] [inspector URL]
 *
 * Defaults to 120 seconds on http://127.0.0.1:9230. A burst usually arrives with a browser reconnect, so keep the
 * window open across a page reload. Ctrl-C prints whatever it collected.
 */

const seconds = Number(process.argv[2] ?? 120)
const inspector = process.argv[3] ?? 'http://127.0.0.1:9230'

const targets = await (await fetch(new URL('/json/list', inspector))).json()
const page = targets.find(target => target.type === 'page')
if (page === undefined) {
  console.error(`no page target at ${inspector}; start DSH with its inspector enabled`)
  process.exit(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
const stacks = []
const scripts = new Map()
let messageId = 0

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

const frameLabel = frame => `${frame.functionName || '(anonymous)'} ${String(frame.url).split('/').slice(-2).join('/')}:${frame.location.lineNumber + 1}`

socket.addEventListener('message', async event => {
  const data = JSON.parse(String(event.data))
  if (data.method === 'Debugger.scriptParsed') {
    scripts.set(data.params.scriptId, data.params.url)
    return
  }
  if (data.method === 'Debugger.paused') {
    stacks.push(data.params.callFrames.slice(0, 12).map(frameLabel).join(' ← '))
    await send('Debugger.resume')
    return
  }
  const entry = pending.get(data.id)
  if (entry === undefined) return
  pending.delete(data.id)
  if (data.error === undefined) entry.resolve(data.result)
  else entry.reject(new Error(JSON.stringify(data.error)))
})

const report = () => {
  const counts = new Map()
  for (const stack of stacks) counts.set(stack, (counts.get(stack) ?? 0) + 1)
  console.log(`\n${stacks.length} cold Session read(s) in ${seconds}s`)
  for (const [stack, count] of [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12)) {
    console.log(`\n${count} ×\n  ${stack}`)
  }
}

await new Promise(resolve => socket.addEventListener('open', resolve))
await send('Debugger.enable')
await new Promise(resolve => setTimeout(resolve, 500))
const queryLib = [...scripts.entries()].find(([, url]) => url.includes('dsh-session-query/lib/index.js'))
if (queryLib === undefined) {
  console.error('the Host has not loaded dsh-session-query yet; retry once it is up')
  process.exit(1)
}
const [scriptId, url] = queryLib
const source = await send('Debugger.getScriptSource', { scriptId })
const readLine = source.scriptSource.split('\n').findIndex(line => line.includes('async read(sessionId'))
if (readLine < 0) {
  console.error(`cannot find the observation read in ${url}`)
  process.exit(1)
}
const breakpoint = await send('Debugger.setBreakpointByUrl', { url, lineNumber: readLine })
console.log(`armed on ${url}:${readLine + 1}; collecting for ${seconds}s (reload the GUI to trigger a burst)`)

process.on('SIGINT', () => {
  report()
  process.exit(0)
})
await new Promise(resolve => setTimeout(resolve, seconds * 1000))
await send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId })
report()
socket.close()
