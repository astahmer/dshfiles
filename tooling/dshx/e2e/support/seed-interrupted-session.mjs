import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const seedInterruptedSession = async ({ homeRoot, profileRoot }) => {
  const projectRequire = createRequire(new URL('../../../../plugins/@dshfiles/session-controller/package.json', import.meta.url))
  const require = createRequire(projectRequire.resolve('@deepseek-ai/dsh/package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const persistence = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
  const { SessionId } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
  const context = new Context()
  try {
    await context.plugin(persistence, { root: join(homeRoot, 'sessions') })
    const handle = await context.sessionPersistence.create({ id: SessionId('session-chat-resume-fixture'), createdAt: Date.now(), cwd: '/tmp', version: 4 })
    await handle.append([
      { type: 'session/title', seq: 0, time: 100, data: { title: 'Interrupted resume fixture', source: 'user' } },
      { type: 'turn/start', seq: 1, time: 200, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 300, data: { turn: 1, reason: { kind: 'interrupted' } } },
      { type: 'turn/start', seq: 3, time: 400, data: { turn: 2 } },
      { type: 'turn/end', seq: 4, time: 500, data: { turn: 2, reason: { kind: 'interrupted' } } },
    ])
    await handle.flush()
    await handle.close()
  } finally {
    await context.fiber.dispose()
  }
}
