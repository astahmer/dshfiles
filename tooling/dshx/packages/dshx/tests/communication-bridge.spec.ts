import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { connectCommunicationClient, startHostCommunicationBridge } from '../src/communication/bridge.js'
import { createCommunicationService } from '../src/communication/service.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

it('uses the shared JSON-line transport for Communication requests and responses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dshx-communication-bridge-'))
  temporaryDirectories.push(directory)
  const service = createCommunicationService({ statePath: join(directory, 'messages.json') })
  const bridge = await startHostCommunicationBridge(service, {
    stateHome: directory,
    listAgents: () => [],
  })

  try {
    const client = await connectCommunicationClient({ stateHome: directory, principalId: 'bridge-test' })
    expect(await client.listAgents()).toEqual([])
    const subscription = await client.subscribe({ topic: 'builds.ready' })
    expect(subscription.topic).toBe('builds.ready')
    expect(await client.listTopics()).toMatchObject([{ topic: 'builds.ready', subscribers: 1 }])
  } finally {
    await bridge.close()
  }
})
