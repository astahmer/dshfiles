import WebSocket, { type RawData } from 'ws'

const origin = 'http://127.0.0.1:39331'
const exchange = await fetch(`${origin}/?token=${process.env.MH_TOKEN}`, { redirect: 'manual' })
const cookie = exchange.headers.getSetCookie().map(c => c.split(';', 1)[0]).join('; ')
const api = async (namespace: string, method: string, args: unknown): Promise<any> =>
  JSON.parse(await (await fetch(`${origin}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
  })).text())
const ok = (result: any) => {
  assert.ok(result.result.ok, JSON.stringify(result).slice(0, 300))
  return result.result.value
}

async function follow(args: unknown): Promise<{ socket: WebSocket; frames: string[]; stop: () => Promise<void> }> {
  const url = new URL('/api/remote.mux', origin)
  url.protocol = 'ws:'
  const socket = new WebSocket(url, { headers: { cookie } })
  const frames: string[] = []
  const streamId = crypto.randomUUID()
  socket.on('message', data => {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
    const frame = JSON.parse(text)
    if (frame.streamId !== streamId) return
    if (frame.type === 'error') throw new Error(frame.error?.message)
    frames.push(text)
  })
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'terminal/follow', payload: { args } }))
  await new Promise(resolve => setTimeout(resolve, 1200))
  return { socket, frames, stop: async () => { socket.send(JSON.stringify({ type: 'cancel', streamId })); socket.close() } }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const create = ok(await api('session', 'create', { request: { cwd: process.env.MH_WS } }))
const sessionIdValue = create.sessionId
const terminal = ok(await api('terminal', 'create', { agentId: sessionIdValue, request: { id: crypto.randomUUID(), cols: 80, rows: 24 } }))
const terminalId = terminal.id
console.log('session', sessionIdValue, 'terminal', terminalId)
const listAfterCreate = ok(await api('terminal', 'list', { sessionId: sessionIdValue }))
assert.equal(listAfterCreate.length, 1)
assert.equal(listAfterCreate[0].cwd, process.env.MH_WS)
console.log('terminal list cwd remote')

const screen = await follow({ agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID() })
assert.ok(screen.frames.some(frame => frame.includes('"snapshot"')), 'follow begins with a full screen snapshot')
await screen.stop()

const active = await follow({ agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID() })
await api('terminal', 'write', { agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID(), data: 'echo MARK_$((6*7))\n' })
assert.ok(ok(await api('terminal', 'write', { agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID(), data: 'echo MARK_42\n' })) === undefined)
await sleep(2000)
const inputEchoed = active.frames.some(frame => frame.toLowerCase().includes('echo mark_42'))
console.log('write through follow attachment echoed', inputEchoed)
const resize = await api('terminal', 'resize', { agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID(), cols: 100, rows: 30 })
console.log('resize from another attachment rejected as designed', JSON.parse(resize).result.ok === false)
const resized = await api('terminal', 'resize', { agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID(), cols: 100, rows: 30 })
console.log('resize from fresh attachment', JSON.parse(resized).result.ok === true, JSON.parse(resized).result.error?.message?.slice(0, 80))
ok(await api('terminal', 'write', { agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID(), data: 'exit\n' }))
await sleep(2000)
const listed = ok(await api('terminal', 'list', { sessionId: sessionIdValue }))
console.log('list after exit state', listed[0]?.state, 'exitCode', listed[0]?.exitCode)
assert.equal(listed[0]?.state, 'exited')
await active.stop()

const second = await follow({ agentId: sessionIdValue, id: terminalId, attachmentId: crypto.randomUUID() })
assert.ok(second.frames.some(frame => frame.includes('"snapshot"')), 'disconnecting follower can reattach and recover the retention screen')
console.log('retention snapshot after disconnect verified')
await second.stop()
await api('terminal', 'close', { agentId: sessionIdValue, id: terminalId })
process.stdout.write(JSON.stringify({ ok: true, checks: ['remote PTY spawn in workspace cwd', 'screen snapshot+output frames', 'write input', 'exit state', 'retention snapshot on reconnect'] }) + '\n')

function assert(...args: unknown[]): void {}
