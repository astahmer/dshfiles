import { workerData, parentPort } from 'node:worker_threads'

import { StreamIds } from '@dshfiles/optmem-core'

import { openSqliteMemory } from '../sqlite-memory.ts'

const path: unknown = workerData?.path
const conversationId: unknown = workerData?.conversationId
const count: unknown = workerData?.count
if (typeof path !== 'string' || typeof conversationId !== 'string' || typeof count !== 'number') throw new Error('append-worker: invalid workerData')

const memory = openSqliteMemory({ path })
for (let turn = 0; turn < count; turn++) {
  await memory.store.appendEvents([
    {
      eventKey: `${conversationId}:${turn}`,
      harness: 'worker',
      conversationId,
      projectId: 'shared',
      parentConversationId: null,
      role: 'user',
      createdAt: turn,
      text: `${conversationId} turn ${turn}`,
      bytes: 16,
      truncated: false,
      meta: {},
      streams: [StreamIds.conversation(conversationId), StreamIds.project('shared')],
    },
  ])
}
memory.close()
parentPort?.postMessage('done')
