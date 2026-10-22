import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityTimelineAdapters } from './adapters.js'
import { createActivityTimelineService } from './service.js'
import type { ActivityIngest } from './types.js'

const temporaryRoots: string[] = []
const now = 1_800_000_000_000

const statePath = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'activity-timeline-'))
  temporaryRoots.push(root)
  return join(root, 'state.json')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const cleanupFailure = (input: { readonly sessionId: string; readonly workspaceId: string; readonly workspaceName: string }): ActivityIngest =>
  ActivityTimelineAdapters.workspaceActivity({
    id: 'workspace:cleanup-failed',
    at: now,
    type: 'workspace.cleanup-failed',
    level: 'attention',
    summary: 'Automatic thread-workspace cleanup failed',
    detail: 'boom',
    ...input,
  })

describe('workspace activity without a workspace', () => {
  it('stores the reported cleanup failure even though it names no workspace', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await expect(service.ingest(cleanupFailure({ sessionId: '', workspaceId: '', workspaceName: '' }))).resolves.toMatchObject({ duplicate: false })
    const page = await service.page({ detailed: true })
    expect(page.items[0]?.references).toEqual([])
  })

  it('drops a blank reference instead of failing the whole event', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await expect(service.ingest(cleanupFailure({ sessionId: '', workspaceId: 'workspace-1', workspaceName: 'thread-a' }))).resolves.toMatchObject({
      duplicate: false,
    })
    const page = await service.page({ detailed: true })
    expect(page.items[0]?.references).toEqual([{ kind: 'workspace', id: 'workspace-1', label: 'thread-a' }])
  })

  it('stores session activity without an invalid blank session reference', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    await expect(service.ingest(ActivityTimelineAdapters.sessionActivity({ kind: 'created', at: now, sessionId: '' }))).resolves.toMatchObject({
      duplicate: false,
    })
    const page = await service.page({ detailed: true })
    expect(page.items[0]).toMatchObject({ sessionId: null, references: [] })
  })

  it('rejects a malformed event through its promise instead of throwing at the caller', async () => {
    const service = createActivityTimelineService({ statePath: await statePath(), now: () => now })
    const malformed: ActivityIngest = {
      ...cleanupFailure({ sessionId: '', workspaceId: 'workspace-1', workspaceName: 'thread-a' }),
      references: [{ kind: 'workspace', id: '', label: null }],
    }
    let pending: Promise<unknown> | undefined
    expect(() => {
      pending = service.enqueue(malformed)
    }).not.toThrow()
    await expect(pending).rejects.toThrow()
  })
})
