import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, default as SessionStore } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { SessionAttentionStore } from '../src/attention-store.ts'
import { ApiSessionAttention } from '../src/attention-controller.ts'

const requireEnvironment = name => {
  const value = process.env[name]
  if (value === undefined) throw new Error(`missing environment variable ${name}`)
  return value
}

let attentionWritePending = false
SessionAttentionStore.prototype.notePrompt = () => {
  attentionWritePending = true
  return new Promise(() => {})
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
session.append('user/message', createUserMessage({
  content: [{ type: 'text', text: 'prompt pending attention sidecar' }],
  source: { kind: 'user' },
}), { surfaceOp: 'append' })

ctx.sessions.flush(session)
for (let attempt = 0; attempt < 1_000; attempt += 1) {
  const durableSession = await sessionHandle.read()
  if (durableSession.events.length > 0 && attentionWritePending) {
    if (attention.summary(sessionId) !== null) throw new Error('Attention sidecar committed before the Session log')
    process.stdout.write('SESSION_LOG_DURABLE_ATTENTION_PENDING\n')
    setInterval(() => {}, 60_000)
    await new Promise(() => {})
  }
  await new Promise(resolve => setTimeout(resolve, 10))
}

throw new Error('Session log did not become durable before the crash boundary')
