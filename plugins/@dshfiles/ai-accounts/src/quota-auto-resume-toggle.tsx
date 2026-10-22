import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { useQuotaContinuations, waitingContinuationFor } from './quota-continuations-query.js'
import { usePreferences } from './use-preferences.js'

const resetLabel = (timestamp: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)

/**
 * The per-thread half of quota auto-resume, sat beside Resume on the failed
 * turn. The recovery it edits already exists; without one this renderer adds
 * nothing, so a thread with no pending quota stop keeps a bare Resume.
 */
export const QuotaAutoResumeToggle = (props: { readonly sessionId: string; readonly seq: number }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const queryClient = useQueryClient()
  const continuations = useQuotaContinuations()
  const continuation = waitingContinuationFor(continuations.data?.continuations, props.sessionId)
  const retry = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (continuation === undefined) throw new Error('Quota recovery is not available.')
      const result = await accounts.setQuotaContinuationAutoRetry({ continuationId: continuation.continuationId, sessionId: props.sessionId, enabled })
      if (!result.updated) throw new Error('Quota recovery is no longer waiting.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiAccountsKeys.quotaContinuations }),
  })
  if (!preferences.showQuotaRetryChoice || continuation === undefined) return null

  const knownReset = continuation.resetAt !== null
  const title = knownReset
    ? `Resume this thread 1 minute after your limit resets ${resetLabel(continuation.resetAt ?? 0)}.`
    : 'Automatic resume needs a known reset time.'
  return (
    <label className="dshx-root dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground" title={title}>
      <Checkbox
        aria-label="Automatically resume after the limit resets"
        checked={continuation.autoRetry}
        disabled={!knownReset || retry.isPending}
        onCheckedChange={checked => retry.mutate(checked === true)}
      />
      <span className="dshx:whitespace-nowrap">Auto-resume</span>
    </label>
  )
}
