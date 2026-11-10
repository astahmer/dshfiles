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
  host.ctx.provide('sessions', { get: () => undefined } as never)
  host.ctx.provide('sessionPersistence', { stat: () => Promise.resolve(undefined) } as never)
  host.ctx.provide('settings', { configure: () => () => undefined } as never)
  await host.mount(plugin, { packageId: '@dshfiles/editor' })
  return { host, client: createHostApiClient(host.ctx, editorArtifactsApi, '@dshfiles/editor') }
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
