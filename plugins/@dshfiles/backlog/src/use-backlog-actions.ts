import type { ApiClientInput } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'

import { backlogApi, type BacklogDetailView, type BacklogSummaryView } from './api.js'

export type BacklogUpdateInput = ApiClientInput<(typeof backlogApi)['methods']['update']>
type UpdateInput = BacklogUpdateInput
type ListData = { readonly revision: number; readonly total: number; readonly items: BacklogSummaryView[] }
type DetailData = { readonly ok: true; readonly value: BacklogDetailView } | { readonly ok: false; readonly reason: 'not-found' }

const QUERY_KEY = 'dshfiles-backlog'

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
  const comment = useMutation({
    mutationFn: (input: Parameters<typeof api.comment>[0]) => api.comment(input),
    onMutate: async input => {
      await client.cancelQueries({ queryKey: [QUERY_KEY] })
      const key = [QUERY_KEY, 'item', input.id] as const
      const previous = client.getQueryData<DetailData>(key)
      const now = Date.now()
      const commentAttachments = (input.files ?? []).map(({ data: _data, ...file }) => ({ ...file, createdAt: now }))
      client.setQueryData<DetailData>(key, current =>
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
                      detail: input.text,
                      ...(commentAttachments.length === 0 ? {} : { attachments: commentAttachments }),
                    },
                  ],
                },
              },
            },
      )
      return { key, previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(context.key, context.previous)
    },
    onSettled: invalidate,
  })
  const attachFile = useMutation({ mutationFn: (input: Parameters<typeof api.attachFile>[0]) => api.attachFile(input), onSuccess: invalidate })
  const removeFile = useMutation({ mutationFn: (input: Parameters<typeof api.removeFile>[0]) => api.removeFile(input), onSuccess: invalidate })
  const triage = useMutation({ mutationFn: (id: number) => api.triage({ id }), onSuccess: invalidate })
  const backfillTriage = useMutation({
    mutationFn: (request: { readonly retriage: boolean }) => api.backfillTriage(request),
    onSuccess: invalidate,
  })
  const applyProposal = useMutation({ mutationFn: (id: number) => api.applyProposal({ id }), onSuccess: invalidate })
  const dismissProposal = useMutation({ mutationFn: (id: number) => api.dismissProposal({ id }), onSuccess: invalidate })
  const deleteItem = useMutation({ mutationFn: (input: Parameters<typeof api.delete>[0]) => api.delete(input), onSuccess: invalidate })
  return { patch, update, capture, link, comment, attachFile, removeFile, triage, backfillTriage, applyProposal, dismissProposal, delete: deleteItem }
}

export class BacklogQueries {
  static readonly key = QUERY_KEY
}
