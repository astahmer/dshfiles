import { describe, expect, it } from 'vitest'
import { MutationObserver, QueryClient } from '@dshfiles/plugin-ui/query'

import type { AgentDispatchOutcome } from './agent-dispatch.js'
import { fileInput, type ComposerFile } from './composer-files.js'
import type { BacklogItem } from './item.js'
import { submitReply } from './reply-submission.js'
import { BacklogModel, type BacklogActor, type BacklogFileRecord } from './store.js'
import { commentMutation } from './use-backlog-actions.js'

const memoryTable = <Value>() => {
  const rows = new Map<string, Value>()
  return {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key: string, value: Value) => {
      rows.set(key, value)
    },
    delete: async (key: string) => rows.delete(key),
    update: async (key: string, change: (current: Value) => Value) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const promise = new Promise<Value>((settle, fail: (reason: Error) => void) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const screenshot: ComposerFile = {
  id: 'file-1',
  kind: 'image',
  name: 'screenshot.png',
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
  dataUrl: 'data:image/png;base64,iVBORw==',
}

const user: BacklogActor = { kind: 'user' }

const setup = async () => {
  const store = BacklogModel.createStore({ files: memoryTable<BacklogFileRecord>(), items: memoryTable<BacklogItem>(), now: () => 1 })
  const created = await store.capture({ text: 'Fix the flaky test', actor: user })
  const id = created.item.id
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const key = ['dshfiles-backlog', 'item', id]
  client.setQueryData(key, { ok: true, value: created })
  const saveGate = deferred<void>()
  const mutation = new MutationObserver(
    client,
    commentMutation({
      client,
      send: async request => {
        await saveGate.promise
        return store.comment({ ...request, actor: user })
      },
    }),
  )
  const cachedComments = () => {
    const data = client.getQueryData<{ readonly ok: boolean; readonly value: typeof created }>(key)
    return (data?.value.item.events ?? []).filter(event => event.kind === 'commented')
  }
  const storedComments = () => {
    const stored = store.get(id)
    return stored.ok ? stored.value.item.events.filter(event => event.kind === 'commented') : []
  }
  const failures: string[] = []
  const view = { text: '', files: [screenshot], failures }
  const viewPort = {
    clear: () => {
      view.text = ''
      view.files = []
    },
    restore: (restored: { readonly text: string; readonly files: readonly ComposerFile[] }) => {
      view.text = restored.text
      view.files = [...restored.files]
    },
    fail: (message: string) => {
      view.failures.push(message)
    },
  }
  return { id, storedComments, saveGate, mutation, cachedComments, view, viewPort }
}

const dispatchPort = (outcome: Promise<AgentDispatchOutcome>) => ({
  dispatch: () => outcome,
  answerReply: async (): Promise<{ readonly ok: true }> => ({ ok: true }),
  smartReplyAnswers: false,
})

describe('submitReply', () => {
  it('shows the comment with its files and clears the input before the agent dispatch resolves', async () => {
    const context = await setup()
    const dispatched = deferred<AgentDispatchOutcome>()
    let dispatchStarted = false
    const submitted = submitReply({
      text: '@reviewer look at this',
      files: [screenshot],
      save: async files => {
        await context.mutation.mutate({ id: context.id, text: '@reviewer look at this', files: files.map(fileInput) })
      },
      dispatch: {
        ...dispatchPort(dispatched.promise),
        dispatch: () => {
          dispatchStarted = true
          return dispatched.promise
        },
      },
      view: context.viewPort,
    })

    await Promise.resolve()
    expect(context.view.files).toEqual([])
    await expect.poll(() => context.cachedComments().map(event => event.attachments?.map(file => file.name))).toEqual([['screenshot.png']])
    expect(dispatchStarted).toBe(false)

    context.saveGate.resolve()
    await expect.poll(() => dispatchStarted).toBe(true)
    expect(context.cachedComments()).toHaveLength(1)
    expect(context.storedComments()).toHaveLength(1)

    dispatched.resolve({ kind: 'dispatched' })
    await submitted
    expect(context.view.failures).toEqual([])
    expect(context.view.text).toBe('')
  })

  it('rolls the comment back and restores the text and files when the save fails', async () => {
    const context = await setup()
    let dispatchStarted = false
    const submitted = submitReply({
      text: '@reviewer look at this',
      files: [screenshot],
      save: async files => {
        await context.mutation.mutate({ id: context.id, text: '@reviewer look at this', files: files.map(fileInput) })
      },
      dispatch: {
        ...dispatchPort(Promise.resolve({ kind: 'dispatched' })),
        dispatch: async () => {
          dispatchStarted = true
          return { kind: 'dispatched' }
        },
      },
      view: context.viewPort,
    })

    await expect.poll(() => context.cachedComments()).toHaveLength(1)
    expect(context.view.files).toEqual([])
    context.saveGate.reject(new Error('Host unreachable'))
    await submitted

    expect(context.cachedComments()).toEqual([])
    expect(context.view.text).toBe('@reviewer look at this')
    expect(context.view.files).toEqual([screenshot])
    expect(context.view.failures).toEqual(['Host unreachable'])
    expect(dispatchStarted).toBe(false)
  })

  it('keeps the saved comment and reports a failed dispatch without restoring the input', async () => {
    const context = await setup()
    context.saveGate.resolve()
    await submitReply({
      text: '@reviewer look at this',
      files: [screenshot],
      save: async files => {
        await context.mutation.mutate({ id: context.id, text: '@reviewer look at this', files: files.map(fileInput) })
      },
      dispatch: dispatchPort(Promise.resolve({ kind: 'failed', reason: 'No project to start in.' })),
      view: context.viewPort,
    })

    expect(context.storedComments()).toHaveLength(1)
    expect(context.view.files).toEqual([])
    expect(context.view.failures).toEqual(['Your reply was saved, but no thread started: No project to start in.'])
  })
})
