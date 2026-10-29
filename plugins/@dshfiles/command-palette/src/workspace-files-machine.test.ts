import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { expect, test } from 'vitest'
import type { WorkspaceFilesState } from '@dshfiles/dshx/client'
import { workspaceFilesMachine } from './workspace-files-machine.js'

test('streams file-index progress and discards replies from cancelled requests', async () => {
  const replies: ((value: WorkspaceFilesState) => void)[] = []
  const signals: AbortSignal[] = []
  const actor = createActor(workspaceFilesMachine, {
    input: {
      client: {
        requestFiles: (respond, signal) => {
          replies.push(respond)
          signals.push(signal)
          return true
        },
      },
    },
  }).start()

  actor.send({ type: 'enable' })
  expect(replies).toHaveLength(1)
  replies[0]?.({ status: 'indexing', sessionId: 'session-one', files: ['src/index.ts'], truncated: false })
  await waitFor(actor, snapshot => snapshot.context.files.status === 'indexing')
  replies[0]?.({ status: 'ready', sessionId: 'session-one', files: ['src/index.ts', 'src/main.ts'], truncated: true })
  await waitFor(actor, snapshot => snapshot.context.files.status === 'ready')

  actor.send({ type: 'disable' })
  expect(signals[0]?.aborted).toBe(true)
  actor.send({ type: 'enable' })
  expect(replies).toHaveLength(2)
  replies[0]?.({ status: 'no-session' })
  expect(actor.getSnapshot().context.files.status).toBe('ready')
  replies[1]?.({ status: 'no-session' })
  await waitFor(actor, snapshot => snapshot.context.files.status === 'no-session')
  actor.stop()
})

test('reports unavailable when no editor listener accepts the file request', async () => {
  const actor = createActor(workspaceFilesMachine, {
    input: { client: { requestFiles: () => false } },
  }).start()

  actor.send({ type: 'enable' })
  await waitFor(actor, snapshot => snapshot.context.files.status === 'unavailable')
  actor.stop()
})
