import type { ApiClientInput } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQueryClient, type QueryClient } from '@dshfiles/plugin-ui/query'

import { backlogApi, type BacklogDetailView, type BacklogSummaryView } from './api.js'

export type BacklogUpdateInput = ApiClientInput<(typeof backlogApi)['methods']['update']>
type UpdateInput = BacklogUpdateInput
type CommentInput = ApiClientInput<(typeof backlogApi)['methods']['comment']>
type ListData = { readonly revision: number; readonly total: number; readonly items: BacklogSummaryView[] }
type DetailData = { readonly ok: true; readonly value: BacklogDetailView } | { readonly ok: false; readonly reason: 'not-found' }

const QUERY_KEY = 'dshfiles-backlog'
export const BACKLOG_TRIAGE_MUTATION_KEY = [QUERY_KEY, 'triage'] as const

/** A reply shows in the item's activity, files included, before the Host answers; a failed save puts the detail back. */
export const commentMutation = <Result>(input: { readonly client: QueryClient; readonly send: (request: CommentInput) => Promise<Result> }) => ({
  mutationFn: input.send,
  onMutate: async (request: CommentInput) => {
    await input.client.cancelQueries({ queryKey: [QUERY_KEY] })
    const key = [QUERY_KEY, 'item', request.id] as const
    const previous = input.client.getQueryData<DetailData>(key)
    const now = Date.now()
    const commentAttachments = (request.files ?? []).map(({ data: _data, ...file }) => ({ ...file, createdAt: now }))
    input.client.setQueryData<DetailData>(key, current =>
      current === undefined || !current.ok
        ? current
        : {
            ...current,
            value: {
              ...current.value,
              item: {
                ...current.value.item,
                lastActivityAt: now,
                actors: current.value.item.actors.some(actor => actor.id === 'user')
                  ? current.value.item.actors
                  : [...current.value.item.actors, { id: 'user', role: 'contributor' }],
                events: [
                  ...current.value.item.events.slice(-199),
                  {
                    at: now,
                    actor: 'user',
                    kind: 'commented',
                    detail: request.text,
                    ...(commentAttachments.length !== 0 && { attachments: commentAttachments }),
                  },
                ],
              },
            },
          },
    )
    return { key, previous }
  },
  onError: (_error: Error, _request: CommentInput, context: { readonly key: readonly unknown[]; readonly previous: DetailData | undefined } | undefined) => {
    if (context?.previous !== undefined) input.client.setQueryData(context.key, context.previous)
  },
  onSettled: (_data: Result | undefined, _error: Error | null, request: CommentInput) =>
    Promise.all([
      input.client.invalidateQueries({ queryKey: [QUERY_KEY] }),
      ...(request.files ?? []).map(file => input.client.invalidateQueries({ queryKey: ['dshfiles-backlog-file', request.id, file.id] })),
    ]),
})

/**
 * Every write the panel makes, shared by the list, the board and the peek. Updates patch the cached lists before the
 * Host answers, so a status change or a drop lands instantly; the refetch afterwards reconciles.
 */
export const useBacklogActions = () => {
  const api = useApi(backlogApi)
  const client = useQueryClient()
  const invalidate = (): Promise<void> => client.invalidateQueries({ queryKey: [QUERY_KEY] })

  /** Applies an update to every cached list and the item's detail at once, so a view transition can capture it. */
  const patch = (input: UpdateInput): void => {
    const { id, ...fields } = input
    const changes = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
    client.setQueriesData<ListData>({ queryKey: [QUERY_KEY, 'list'] }, current =>
      current === undefined
        ? current
        : { ...current, items: current.items.map(item => (item.id === id ? { ...item, ...changes, lastActivityAt: Date.now() } : item)) },
    )
    client.setQueryData<DetailData>([QUERY_KEY, 'item', id], current =>
      current === undefined || !current.ok ? current : { ...current, value: { ...current.value, item: { ...current.value.item, ...changes } } },
    )
  }

  const update = useMutation({
    mutationFn: (input: UpdateInput) => api.update(input),
    onMutate: async input => {
      await client.cancelQueries({ queryKey: [QUERY_KEY] })
      patch(input)
    },
    onSettled: invalidate,
  })
  const capture = useMutation({ mutationFn: (input: Parameters<typeof api.capture>[0]) => api.capture(input), onSuccess: invalidate })
  const link = useMutation({ mutationFn: (input: Parameters<typeof api.link>[0]) => api.link(input), onSuccess: invalidate })
  const comment = useMutation(commentMutation({ client, send: input => api.comment(input) }))
  const editComment = useMutation({ mutationFn: (input: Parameters<typeof api.editComment>[0]) => api.editComment(input), onSuccess: invalidate })
  const deleteComment = useMutation({ mutationFn: (input: Parameters<typeof api.deleteComment>[0]) => api.deleteComment(input), onSuccess: invalidate })
  const attachFile = useMutation({ mutationFn: (input: Parameters<typeof api.attachFile>[0]) => api.attachFile(input), onSuccess: invalidate })
  const removeFile = useMutation({ mutationFn: (input: Parameters<typeof api.removeFile>[0]) => api.removeFile(input), onSuccess: invalidate })
  const triage = useMutation({ mutationKey: BACKLOG_TRIAGE_MUTATION_KEY, mutationFn: (id: number) => api.triage({ id }), onSuccess: invalidate })
  const backfillTriage = useMutation({
    mutationFn: (request: { readonly retriage: boolean }) => api.backfillTriage(request),
  })
  const applyProposal = useMutation({ mutationFn: (id: number) => api.applyProposal({ id }), onSuccess: invalidate })
  const dismissProposal = useMutation({ mutationFn: (id: number) => api.dismissProposal({ id }), onSuccess: invalidate })
  const deleteItem = useMutation({ mutationFn: (input: Parameters<typeof api.delete>[0]) => api.delete(input), onSuccess: invalidate })
  return {
    patch,
    update,
    capture,
    link,
    comment,
    editComment,
    deleteComment,
    attachFile,
    removeFile,
    triage,
    backfillTriage,
    applyProposal,
    dismissProposal,
    delete: deleteItem,
  }
}

export class BacklogQueries {
  static readonly key = QUERY_KEY
}
