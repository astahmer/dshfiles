import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, default as SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { LIVE_WRITE_BATCH_MAX_DELAY_MS } from '../../session-persistence-jsonl/src/storage.ts'
import { ApiSessionAttention } from '../src/attention-controller.ts'

const requireEnvironment = name => {
  const value = process.env[name]
  if (value === undefined) throw new Error(`missing environment variable ${name}`)
  return value
}

const ctx = new Context()
await ctx.plugin(Storage)
await ctx.plugin(StorageJson, { root: requireEnvironment('DSH_ATTENTION_ROOT') })
await ctx.plugin(StorageDomain, { backend: 'json' })
await ctx.plugin(SessionStore)
await ctx.plugin(JsonlSessionPersistence, {
  root: requireEnvironment('DSH_SESSION_ROOT'),
  compression: 'none',
})

const attention = new ApiSessionAttention(ctx)
await attention.ready
const sessionId = SessionId(requireEnvironment('DSH_SESSION_ID'))
const session = ctx.sessions.create(sessionId, { meta: { cwd: '/tmp' } })
const sessionHandle = await ctx.sessionPersistence.create(session.header)
await sessionHandle.flush()

const nativeSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
  callback,
  delay === LIVE_WRITE_BATCH_MAX_DELAY_MS ? 60_000 : delay,
  ...args,
)

session.append('user/message', createUserMessage({
  content: [{ type: 'text', text: 'prompt pending Session flush' }],
  source: { kind: 'user' },
}), { surfaceOp: 'append' })
await attention.flush()

const durableSession = await sessionHandle.read()
if (durableSession.events.length !== 0) throw new Error('Session batch became durable before the crash boundary')
if (attention.summary(sessionId)?.lastPromptSeq !== 0) throw new Error('Attention prompt receipt is not durable before the crash boundary')

process.stdout.write('ATTENTION_DURABLE\n')
await new Promise(() => {})
