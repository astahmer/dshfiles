import { describe, expect, it } from 'vitest'

import type { BacklogSyncBindingView, BacklogSyncItemView, BacklogSyncStatusView } from './api.js'
import { BacklogSyncModel } from './sync-model.js'
import { SyncBatch } from './sync-batch.js'

const bindingView = (input: {
  readonly id: string
  readonly container: string
  readonly scope: string | null
  readonly enabled?: boolean
  readonly owned?: boolean
}): BacklogSyncBindingView => ({
  binding: {
    id: input.id,
    connectionId: 'github',
    container: input.container,
    scope: input.scope,
    direction: 'two-way',
    fieldMap: BacklogSyncModel.defaultFieldMap(),
    conflictPolicy: 'lww',
    pollEverySec: 0,
    pushAgentComments: false,
    importNew: false,
    enabled: input.enabled ?? true,
    ownerHostId: 'host-a',
  },
  providerKind: 'github',
  connectionLabel: 'GitHub',
  owned: input.owned ?? true,
  linked: 0,
  lastPassAt: null,
})

const linkedItem = (itemId: number, bindingId: string): BacklogSyncItemView => ({
  itemId,
  ref: String(itemId),
  bindingId,
  backend: 'github',
  connectionLabel: 'GitHub',
  remoteKey: `acme/app#${String(itemId)}`,
  url: `https://github.com/acme/app/issues/${String(itemId)}`,
  state: 'synced',
  lastSyncedAt: 1,
  lastError: null,
  conflicts: [],
})

const status = (input: { readonly bindings: readonly BacklogSyncBindingView[]; readonly items?: readonly BacklogSyncItemView[] }): BacklogSyncStatusView => ({
  bindings: input.bindings,
  items: input.items ?? [],
})

const appBinding = bindingView({ id: 'github-app', container: 'acme/app', scope: '/Users/me/app' })
const chatBinding = bindingView({ id: 'github-chat', container: 'acme/chat', scope: '/Users/me/chat' })
const everywhereBinding = bindingView({ id: 'github-all', container: 'acme/all', scope: null })

describe('sync batch', () => {
  it('offers a binding only for the selected items its scope covers and that have no remote item yet', () => {
    const targets = SyncBatch.targets({
      status: status({ bindings: [appBinding, chatBinding, everywhereBinding], items: [linkedItem(12, 'github-all')] }),
      items: [
        { id: 12, project: '/Users/me/app' },
        { id: 14, project: '/Users/me/app' },
        { id: 16, project: null },
      ],
    })

    expect(targets.map(target => [target.view.binding.id, target.itemIds])).toEqual([
      ['github-app', [12, 14]],
      ['github-all', [14, 16]],
    ])
  })

  it('reads a thread workspace path as the project it belongs to, and skips bindings another Host runs', () => {
    const targets = SyncBatch.targets({
      status: status({
        bindings: [appBinding, bindingView({ id: 'github-remote', container: 'acme/remote', scope: null, owned: false })],
      }),
      items: [{ id: 21, project: '/Users/me/app-threads/thread-abc' }],
    })

    expect(targets.map(target => target.view.binding.id)).toEqual(['github-app'])
  })

  it('offers nothing when every selected item is already mirrored through each binding', () => {
    const targets = SyncBatch.targets({
      status: status({ bindings: [appBinding], items: [linkedItem(12, 'github-app')] }),
      items: [{ id: 12, project: '/Users/me/app' }],
    })

    expect(targets).toEqual([])
  })

  it('reports one created count, and names the first failure with where to retry it', () => {
    expect(SyncBatch.notice({ label: 'GitHub · acme/app', total: 2, failures: [] })).toEqual({
      text: 'Created 2 remote items in GitHub · acme/app.',
      kind: 'success',
    })
    expect(SyncBatch.notice({ label: 'GitHub · acme/app', total: 1, failures: [] })).toEqual({
      text: 'Created 1 remote item in GitHub · acme/app.',
      kind: 'success',
    })
    expect(SyncBatch.notice({ label: 'GitHub · acme/app', total: 3, failures: ['b:x1: the token is refused'] })).toEqual({
      text: 'Created 2 of 3 remote items in GitHub · acme/app; b:x1: the token is refused Retry that item from its own menu.',
      kind: 'failure',
    })
  })
})
