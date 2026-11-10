import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionTurnOutline from '@deepseek-ai/dsh-session-turn-outline'
import { afterEach, expect, it } from 'vitest'
import { promptedTurnCountProjection } from './prompted-turn-count.js'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

const fixture = async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(promptedTurnCountProjection)
  await ctx.plugin(SessionTurnOutline)
  const session = ctx.sessions.create(SessionId('prompted-turns'))
  const read = () => ctx.sessionProjections.snapshot(session, ['promptedTurnCount', 'turnOutline']).values
  return { session, read }
}

const say = (session: Session, text: string, kind: 'user' | 'user-approval' = 'user') => {
  const source = kind === 'user' ? { kind } : { kind, form: 'recall' as const }
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source }), { surfaceOp: 'append' })
}

it('counts each turn a human prompt opened, as the turn outline marks them', async () => {
  const { session, read } = await fixture()
  session.append('turn/start', { turn: 1 })
  say(session, 'first prompt')
  say(session, 'a steer in the same turn')
  session.append('turn/start', { turn: 2 })
  say(session, '   ')
  session.append('turn/start', { turn: 3 })
  say(session, 'an approval recall', 'user-approval')
  session.append('turn/start', { turn: 4 })
  say(session, 'second prompt')
  session.append('turn/start', { turn: 4 })
  say(session, 'a retried turn keeps its count')

  const values = read()
  expect(values.promptedTurnCount).toBe(2)
  expect(values.turnOutline?.filter(entry => entry.prompt.trim().length > 0)).toHaveLength(values.promptedTurnCount ?? -1)
})

it('ignores a message before the first turn starts', async () => {
  const { session, read } = await fixture()
  say(session, 'seeded before any turn')
  expect(read().promptedTurnCount).toBe(0)
})
