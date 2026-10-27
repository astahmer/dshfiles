import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const attachmentFixtures = fileURLToPath(new URL('../fixtures/attachments/', import.meta.url))
const scrollFixture = Array.from(
  { length: 24 },
  (_, index) => `Transcript row ${String(index + 1)} keeps the image preview above floating chat controls.`,
).join('\n\n')

export const seedChatImageLinkSession = async ({ homeRoot }) => {
  const projectRequire = createRequire(new URL('../../../../plugins/@dshfiles/session-controller/package.json', import.meta.url))
  const require = createRequire(projectRequire.resolve('@deepseek-ai/dsh/package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const persistence = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
  const { SessionId } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
  const { createAssistantMessage, createToolResultMessage, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
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
            content: [
              { type: 'text', text: `Earlier turn image\n\n${scrollFixture}` },
              { type: 'tool-call', id: 'fixture-read-image-red-older', name: 'read_image', arguments: JSON.stringify({ file_path: 'red.png' }) },
            ],
            source: { provider: 'fixture', model: 'fixture' },
          }),
          stream: [],
        },
      },
      {
        type: 'tool/call',
        seq: 6,
        time: 650,
        data: { turn: 1, step: 1, callId: 'fixture-read-image-red-older', name: 'read_image', arguments: JSON.stringify({ file_path: 'red.png' }) },
      },
      {
        type: 'tool/result',
        seq: 7,
        time: 675,
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({ callId: 'fixture-read-image-red-older', isError: false, content: [{ type: 'text', text: 'Image read' }] }),
        },
      },
      { type: 'step/end', seq: 8, time: 750, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 9, time: 800, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 10, time: 900, data: { turn: 2 } },
      {
        type: 'user/message',
        seq: 11,
        time: 910,
        surfaceOp: 'append',
        data: createUserMessage({ content: [{ type: 'text', text: 'Open another image' }], source: { kind: 'user' } }),
      },
      { type: 'step/start', seq: 12, time: 920, data: { turn: 2, step: 1 } },
      {
        type: 'assistant/message',
        seq: 13,
        time: 930,
        surfaceOp: 'append',
        data: {
          turn: 2,
          step: 1,
          message: createAssistantMessage({
            content: [
              { type: 'text', text: `[red.png](red.png)\n\n${scrollFixture}` },
              { type: 'tool-call', id: 'fixture-read-image-blue-later', name: 'read_image', arguments: JSON.stringify({ file_path: 'blue.png' }) },
              { type: 'tool-call', id: 'fixture-read-image-red-later', name: 'read_image', arguments: JSON.stringify({ file_path: 'red.png' }) },
            ],
            source: { provider: 'fixture', model: 'fixture' },
          }),
          stream: [],
        },
      },
      {
        type: 'tool/call',
        seq: 14,
        time: 940,
        data: { turn: 2, step: 1, callId: 'fixture-read-image-blue-later', name: 'read_image', arguments: JSON.stringify({ file_path: 'blue.png' }) },
      },
      {
        type: 'tool/result',
        seq: 15,
        time: 960,
        surfaceOp: 'append',
        data: {
          turn: 2,
          step: 1,
          message: createToolResultMessage({ callId: 'fixture-read-image-blue-later', isError: false, content: [{ type: 'text', text: 'Image read' }] }),
        },
      },
      {
        type: 'tool/call',
        seq: 16,
        time: 970,
        data: { turn: 2, step: 1, callId: 'fixture-read-image-red-later', name: 'read_image', arguments: JSON.stringify({ file_path: 'red.png' }) },
      },
      {
        type: 'tool/result',
        seq: 17,
        time: 980,
        surfaceOp: 'append',
        data: {
          turn: 2,
          step: 1,
          message: createToolResultMessage({ callId: 'fixture-read-image-red-later', isError: false, content: [{ type: 'text', text: 'Image read' }] }),
        },
      },
      { type: 'step/end', seq: 18, time: 990, data: { turn: 2, step: 1 } },
      { type: 'turn/end', seq: 19, time: 1000, data: { turn: 2, reason: { kind: 'completed' } } },
    ])
    await handle.flush()
    await handle.close()
  } finally {
    await context.fiber.dispose()
  }
}
