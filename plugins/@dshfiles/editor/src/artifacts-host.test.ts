import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { expect, test } from 'vitest'
import { editorArtifactsApi } from './artifacts-api.js'
import plugin from './host.js'

const mount = async (root: string) => {
  const host = await createTestHost()
  await host.ctx.plugin(Storage)
  await host.ctx.plugin(StorageJson, { root })
  await host.ctx.plugin(StorageDomain, { backend: 'json' })
  const live = new Map([
    ['session-a', { header: { cwd: root } }],
    ['session-b', { header: { cwd: root } }],
    ['session-a-child', { header: { cwd: root, origin: 'subagent', parentSession: 'session-a' } }],
  ])
  // SAFETY: the editor reads only `get` of the live session store and `stat` of the persisted one.
  host.ctx.provide('sessions', { get: (sessionId: string) => live.get(sessionId) } as never)
  host.ctx.provide('sessionPersistence', { stat: () => Promise.resolve(undefined) } as never)
  host.ctx.provide('settings', { configure: () => () => undefined } as never)
  await host.mount(plugin, { packageId: '@dshfiles/editor' })
  const agentTool = (sessionId: string, name: string, args: Readonly<Record<string, string | number | boolean>>) =>
    // SAFETY: the dshx tool edge reads only the Agent's id and its session header's cwd to name the caller.
    host.runTool({ name, arguments: args, agent: { id: sessionId, session: { header: {} } } as never })
  return { host, agentTool, client: createHostApiClient(host.ctx, editorArtifactsApi, '@dshfiles/editor') }
}

test('artifacts survive restart, isolate sessions, and serialize revision checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editor-artifacts-'))
  let fixture = await mount(root)
  try {
    const created = await fixture.client.create({ sessionId: 'session-a', title: 'Notes', mimeType: 'text/markdown', content: 'one' })
    const id = created.artifact.id
    await expect(fixture.client.create({ sessionId: 'session-a', title: 'bad', mimeType: 'text/plain', content: 'x' } as never)).rejects.toThrow()
    await expect(fixture.client.create({ sessionId: 'session-a', title: 'bad', mimeType: 'text/html', content: 'é'.repeat(130_000) })).rejects.toThrow()
    await expect(fixture.client.delete({ sessionId: 'session-a', id, expectedRevision: 1, confirm: false } as never)).rejects.toThrow()
    await expect(fixture.client.read({ id })).rejects.toThrow()
    expect(created.artifact.revision).toBe(1)
    expect((await fixture.client.list({ sessionId: 'session-b' })).artifacts).toEqual([])
    const attempts = await Promise.all([
      fixture.client.update({ sessionId: 'session-a', id, expectedRevision: 1, content: 'two' }),
      fixture.client.update({ sessionId: 'session-a', id, expectedRevision: 1, content: 'three' }),
    ])
    expect(attempts.filter(value => 'artifact' in value)).toHaveLength(1)
    expect(attempts.filter(value => 'status' in value)).toEqual([{ status: 'conflict', currentRevision: 2 }])
    await fixture.host.dispose()
    fixture = await mount(root)
    const read = await fixture.client.read({ sessionId: 'session-a', id })
    expect(read.artifact.revision).toBe(2)
    expect(['two', 'three']).toContain(read.artifact.content)
    expect(await fixture.client.delete({ sessionId: 'session-a', id, expectedRevision: 1, confirm: true })).toEqual({ status: 'conflict', currentRevision: 2 })
    expect(await fixture.client.delete({ sessionId: 'session-a', id, expectedRevision: 2, confirm: true })).toEqual({ deleted: true })
    expect((await fixture.client.list({ sessionId: 'session-a' })).artifacts).toEqual([])
  } finally {
    await fixture.host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('artifacts belong to an existing thread, and an agent reaches only its own thread and its subagents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editor-artifacts-'))
  const fixture = await mount(root)
  try {
    await expect(fixture.client.create({ sessionId: 'session-unknown', title: 'Notes', mimeType: 'text/markdown', content: 'x' })).rejects.toMatchObject({
      remoteCode: 'session-not-found',
    })
    await expect(fixture.client.list({ sessionId: 'session-unknown' })).rejects.toMatchObject({ remoteCode: 'session-not-found' })
    const foreign = await fixture.client.create({ sessionId: 'session-b', title: 'Theirs', mimeType: 'text/markdown', content: 'secret' })

    const refused = { isError: true, content: [{ type: 'text', text: expect.stringContaining('session-b') }] }
    expect(await fixture.agentTool('session-a', 'artifact_list', { sessionId: 'session-b' })).toMatchObject(refused)
    expect(await fixture.agentTool('session-a', 'artifact_read', { sessionId: 'session-b', id: foreign.artifact.id })).toMatchObject(refused)
    expect(
      await fixture.agentTool('session-a', 'artifact_create', { sessionId: 'session-b', title: 'Injected', mimeType: 'text/markdown', content: 'x' }),
    ).toMatchObject(refused)
    expect(
      await fixture.agentTool('session-a', 'artifact_delete', { sessionId: 'session-b', id: foreign.artifact.id, expectedRevision: 1, confirm: true }),
    ).toMatchObject(refused)
    expect((await fixture.client.list({ sessionId: 'session-b' })).artifacts.map(artifact => artifact.title)).toEqual(['Theirs'])

    expect(
      await fixture.agentTool('session-a', 'artifact_create', { sessionId: 'session-a-child', title: 'Child', mimeType: 'text/markdown', content: 'x' }),
    ).not.toHaveProperty('isError', true)
    expect(await fixture.agentTool('session-a', 'artifact_create', { title: 'Mine', mimeType: 'text/markdown', content: 'x' })).not.toHaveProperty(
      'isError',
      true,
    )
  } finally {
    await fixture.host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
