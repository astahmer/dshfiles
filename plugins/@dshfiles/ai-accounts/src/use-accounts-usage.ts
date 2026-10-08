import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { accountKindSchema, aiAccountsApi, usageCardSchema, type AccountsUsage } from './api.js'
import { usePreferences } from './use-preferences.js'

/**
 * A Host older than this Client answers without the card labels or the
 * `refreshUsage` method; read what is there and fill the rest, so a surface
 * degrades to plainer cards instead of failing until DSH restarts.
 */
const tolerantUsageSchema = z.object({
  readAt: z.number().catch(() => Date.now()),
  hostName: z.string().catch(''),
  cards: z.array(
    z.object({
      instanceId: z.string(),
      displayName: z.string().optional().catch(undefined),
      kind: accountKindSchema.catch('codex'),
      enabled: z.boolean().catch(true),
      usage: usageCardSchema,
    }),
  ),
})

const normalizeUsage = (raw: unknown): AccountsUsage | null => {
  const parsed = tolerantUsageSchema.safeParse(raw)
  if (!parsed.success) return null
  return { ...parsed.data, cards: parsed.data.cards.map(card => ({ ...card, displayName: card.displayName ?? card.instanceId })) }
}

/**
 * Live quota for a surface. Every surface polls on the configured interval; the
 * Host shares one cached sweep between them, and `refresh` bypasses that cache.
 */
export const useAccountsUsage = (options: { readonly enabled?: boolean } = {}) => {
  const accounts = useApi(aiAccountsApi)
  const { usageRefreshMs } = usePreferences()
  const enabled = options.enabled ?? true
  const [usage, setUsage] = useState<AccountsUsage | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      void accounts
        .usage()
        .then(next => {
          if (cancelled) return
          const normalized = normalizeUsage(next)
          setUsage(normalized)
          setFailed(normalized === null)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    }
    load()
    const timer = setInterval(load, usageRefreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [accounts, enabled, usageRefreshMs])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = normalizeUsage(await accounts.refreshUsage().catch(() => accounts.usage()))
      setUsage(next)
      setFailed(next === null)
    } catch {
      setFailed(true)
    } finally {
      setRefreshing(false)
    }
  }, [accounts])

  return { usage, refreshing, failed, refresh }
}
