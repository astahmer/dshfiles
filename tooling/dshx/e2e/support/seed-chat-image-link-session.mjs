import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const attachmentFixtures = fileURLToPath(new URL('../fixtures/attachments/', import.meta.url))

export const seedChatImageLinkSession = async ({ homeRoot }) => {
  const projectRequire = createRequire(new URL('../../../../plugins/@dshfiles/session-controller/package.json', import.meta.url))
  const require = createRequire(projectRequire.resolve('@deepseek-ai/dsh/package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const persistence = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
  const { SessionId } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
  const { createAssistantMessage, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
  const context = new Context()
  try {
    await context.plugin(persistence, { root: join(homeRoot, 'sessions') })
    const handle = await context.sessionPersistence.create({
      id: SessionId('session-chat-image-link-fixture'),
      createdAt: Date.now(),
      cwd: attachmentFixtures,
      version: 4,
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'standard',
    })
    await handle.append([
      { type: 'permission/preset', seq: 0, time: 100, data: { preset: 'workspace-write' } },
      { type: 'session/title', seq: 1, time: 200, data: { title: 'Chat image link fixture', messageSeqs: [], source: { kind: 'user' } } },
      { type: 'turn/start', seq: 2, time: 300, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 3,
        time: 400,
        surfaceOp: 'append',
        data: createUserMessage({ content: [{ type: 'text', text: 'Open the linked image' }], source: { kind: 'user' } }),
      },
      { type: 'step/start', seq: 4, time: 500, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: 5,
        time: 600,
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: '[red.png](red.png)' }],
            source: { provider: 'fixture', model: 'fixture' },
          }),
          stream: [],
        },
      },
      { type: 'step/end', seq: 6, time: 700, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 7, time: 800, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    await handle.flush()
    await handle.close()
  } finally {
    await context.fiber.dispose()
  }
}
