import { failure, validateScope } from './errors.js'

export const ingest = async ({ store, organization, provider, fetchPage, sleep, maxPages = 3, maxAttempts = 4, retryMinDelayMs = 90000, signal }) => {
  validateScope({ organization, provider })
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10 ||
    !Number.isSafeInteger(retryMinDelayMs) ||
    retryMinDelayMs < 0
  )
    throw failure({ code: 'IC_INVALID_OPTIONS', message: 'Invalid bounded ingestion options' })
  let pagesCommitted = 0
  const result = ({ status, reason }) => {
    const current = store.scope({ organization, provider })
    return { status, reason, pagesCommitted, recordCount: current.records.length, nextPage: current.nextPage }
  }
  while (pagesCommitted < maxPages) {
    if (signal?.aborted) return result({ status: 'cancelled', reason: 'aborted' })
    const current = store.scope({ organization, provider })
    if (current.complete) return result({ status: 'complete', reason: null })
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response
      try {
        response = await fetchPage({ organization, provider, page: current.nextPage, attempt, signal })
      } catch {
        response = { status: 503 }
      }
      if (signal?.aborted) return result({ status: 'cancelled', reason: 'aborted' })
      if (response.status === 200) {
        const committed = await store.commitPage({
          organization,
          provider,
          page: current.nextPage,
          nextPage: response.nextPage,
          records: response.records,
          done: response.done ?? false,
        })
        if (committed.status === 'committed') pagesCommitted += 1
        break
      }
      if (response.status === 429 && response.quotaExhausted === true) return result({ status: 'partial', reason: 'quota' })
      if (![429, 503].includes(response.status)) return result({ status: 'partial', reason: 'provider-permanent' })
      if (attempt === maxAttempts) return result({ status: 'partial', reason: 'retry-exhausted' })
      const retryAfter = Number.isFinite(response.retryAfterSeconds) && response.retryAfterSeconds >= 0 ? response.retryAfterSeconds * 1000 : 0
      await sleep(Math.max(retryMinDelayMs, retryAfter))
      if (signal?.aborted) return result({ status: 'cancelled', reason: 'aborted' })
    }
  }
  if (store.scope({ organization, provider }).complete) return result({ status: 'complete', reason: null })
  return result({ status: 'partial', reason: 'page-budget' })
}
