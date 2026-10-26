import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useApi } from '@dshfiles/dshx/client'
import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { aiAccountsKeys } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { useQuotaContinuations, waitingContinuationFor } from './quota-continuations-query.js'
import { usePreferences } from './use-preferences.js'

const resetLabel = (timestamp: number): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)

const QUOTA_CONTINUATION_UPDATED_EVENT = 'dshfiles:ai-accounts:quota-continuation-updated'

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
  useEffect(() => {
    const refresh = (): void => void queryClient.invalidateQueries({ queryKey: aiAccountsKeys.quotaContinuations })
    window.addEventListener(QUOTA_CONTINUATION_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(QUOTA_CONTINUATION_UPDATED_EVENT, refresh)
  }, [queryClient])
  const retry = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (continuation === undefined) throw new Error('Quota recovery is not available.')
      const result = await accounts.setQuotaContinuationAutoRetry({ continuationId: continuation.continuationId, sessionId: props.sessionId, enabled })
      if (!result.updated) throw new Error('Quota recovery is no longer waiting.')
    },
    onSettled: () => window.dispatchEvent(new Event(QUOTA_CONTINUATION_UPDATED_EVENT)),
  })
  if (!preferences.showQuotaRetryChoice || continuation === undefined) return null

  const knownReset = continuation.resetAt !== null
  const title = knownReset
    ? `Resume this thread 1 minute after your limit resets ${resetLabel(continuation.resetAt ?? 0)}.`
    : 'Automatic resume needs a known reset time.'
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <label className="dshx-root dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
            <Checkbox
              aria-label="Automatically resume after the limit resets"
              checked={continuation.autoRetry}
              disabled={!knownReset || retry.isPending}
              onCheckedChange={checked => retry.mutate(checked === true)}
            />
            <span className="dshx:whitespace-nowrap">Auto-resume</span>
          </label>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
