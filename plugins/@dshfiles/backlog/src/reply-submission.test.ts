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
  return { id, store, client, storedComments, saveGate, mutation, cachedComments, view, viewPort }
}

const dispatchPort = (outcome: Promise<AgentDispatchOutcome>) => ({
  dispatch: (_input: { readonly text: string }) => outcome,
  answerReply: async (_input: { readonly text: string }): Promise<{ readonly ok: true }> => ({ ok: true }),
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
        dispatch: (_input: { readonly text: string }) => {
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

  it('refreshes an attachment read that first missed while the optimistic reply was saving', async () => {
    const context = await setup()
    const attachmentKey = ['dshfiles-backlog-file', context.id, screenshot.id]
    const readFile = () =>
      context.client.fetchQuery({
        queryKey: attachmentKey,
        queryFn: () => context.store.readFile({ id: context.id, attachmentId: screenshot.id }),
        staleTime: Infinity,
      })

    expect(await readFile()).toEqual({ ok: false, reason: 'not-found' })

    context.saveGate.resolve()
    await context.mutation.mutate({ id: context.id, text: 'like this', files: [fileInput(screenshot)] })

    expect(await readFile()).toMatchObject({ ok: true, value: { dataUrl: 'data:image/png;base64,iVBORw==' } })
  })

  it('saves an attachment-only comment without dispatching an empty reply', async () => {
    const context = await setup()
    context.saveGate.resolve()
    let dispatchStarted = false

    await submitReply({
      text: '',
      files: [screenshot],
      save: async files => {
        await context.mutation.mutate({ id: context.id, text: '', files: files.map(fileInput) })
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

    expect(context.storedComments()).toMatchObject([{ detail: '', attachments: [{ name: 'screenshot.png' }] }])
    expect(dispatchStarted).toBe(false)
    expect(context.view.failures).toEqual([])
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
        dispatch: async (_input: { readonly text: string }) => {
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

  it('shows and clears the thinking state while generating an AI answer', async () => {
    const context = await setup()
    context.saveGate.resolve()
    const answer = deferred<{ readonly ok: true }>()
    const answering: boolean[] = []
    const submitted = submitReply({
      text: 'Could you explain this?',
      files: [],
      save: async () => {
        await context.mutation.mutate({ id: context.id, text: 'Could you explain this?' })
      },
      dispatch: {
        ...dispatchPort(Promise.resolve({ kind: 'skipped', reason: 'reply-only' })),
        answerReply: (_input: { readonly text: string }) => answer.promise,
        smartReplyAnswers: true,
      },
      view: context.viewPort,
      onAnswering: value => answering.push(value),
    })

    await expect.poll(() => answering).toEqual([true])
    answer.resolve({ ok: true })
    await submitted

    expect(answering).toEqual([true, false])
    expect(context.view.failures).toEqual([])
  })

  it('passes the complete submitted text once to automatic answer generation', async () => {
    const context = await setup()
    context.saveGate.resolve()
    const submittedText = 'I was typing @emi go while finishing this complete answer.'
    const dispatchTexts: string[] = []
    const answerTexts: string[] = []

    await submitReply({
      text: submittedText,
      files: [],
      save: async () => {
        await context.mutation.mutate({ id: context.id, text: submittedText })
      },
      dispatch: {
        ...dispatchPort(Promise.resolve({ kind: 'skipped', reason: 'reply-only' })),
        dispatch: async ({ text }) => {
          dispatchTexts.push(text)
          return { kind: 'skipped', reason: 'reply-only' }
        },
        answerReply: async ({ text }) => {
          answerTexts.push(text)
          return { ok: true }
        },
        smartReplyAnswers: true,
      },
      view: context.viewPort,
    })

    expect(context.storedComments().map(event => event.detail)).toEqual([submittedText])
    expect(dispatchTexts).toEqual([submittedText])
    expect(answerTexts).toEqual([submittedText])
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
