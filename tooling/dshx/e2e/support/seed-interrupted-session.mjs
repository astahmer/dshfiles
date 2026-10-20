import { randomUUID } from 'node:crypto'
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
    const handle = await context.sessionPersistence.create({
      id: SessionId('session-chat-resume-fixture'),
      createdAt: Date.now(),
      cwd: '/tmp',
      version: 4,
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'standard',
    })
    await handle.append([
      { type: 'permission/preset', seq: 0, time: 100, data: { preset: 'workspace-write' } },
      { type: 'session/title', seq: 1, time: 200, data: { title: 'Interrupted resume fixture', messageSeqs: [], source: { kind: 'user' } } },
      { type: 'turn/start', seq: 2, time: 300, data: { turn: 1 } },
      { type: 'turn/end', seq: 3, time: 400, data: { turn: 1, reason: { kind: 'interrupted' } } },
      { type: 'turn/start', seq: 4, time: 500, data: { turn: 2 } },
      { type: 'turn/end', seq: 5, time: 600, data: { turn: 2, reason: { kind: 'interrupted' } } },
      {
        type: 'user/message',
        seq: 6,
        time: 700,
        surfaceOp: 'append',
        data: { id: randomUUID(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'resume' }] },
      },
    ])
    await handle.flush()
    await handle.close()
  } finally {
    await context.fiber.dispose()
  }
}
