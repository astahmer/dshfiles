import { isApiOwnerMissing, type ApiClient } from '@dshfiles/dshx/api'
import { subscribeApiEvent } from '@dshfiles/dshx/client'
import type { multiHostApi, RemoteInteraction } from './api.js'

/** A connected event stream announces every change; this only covers a missed frame. */
const liveInterval = 15_000
/** Without the event stream this read is the feed. */
const fallbackInterval = 2_000
/** A Host that keeps failing, such as an older one that lacks the method until it restarts, is asked rarely. */
const failedInterval = 30_000

type Methods = (typeof multiHostApi)['methods']
type Events = NonNullable<(typeof multiHostApi)['events']>
type MultiHostClient = ApiClient<Methods, Events>

/**
 * What remote threads wait on, read once and again on each change. It stops for good on a Host without multi-host. A
 * failed read reports nothing: a blip must not close a card, and the owner refuses an answer to a request that went.
 * @param input - the API client, and the listener each read reaches.
 * @returns the unsubscribe function.
 */
export const watchRemoteInteractions = (input: {
  readonly client: MultiHostClient
  readonly onChange: (interactions: readonly RemoteInteraction[]) => void
}): (() => void) => {
  const lifetime = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let interval = fallbackInterval
  let failed = false
  let reading = false
  let readAgain = false

  const schedule = (): void => {
    clearTimeout(timer)
    if (!lifetime.signal.aborted) timer = setTimeout(() => void read(), failed ? failedInterval : interval)
  }

  const read = async (): Promise<void> => {
    if (reading) {
      readAgain = true
      return
    }
    reading = true
    try {
      const result = await input.client.sessionInteractions({}, { signal: lifetime.signal })
      failed = !result.ok
      if (result.ok && !lifetime.signal.aborted) input.onChange(result.interactions)
    } catch (error) {
      failed = true
      if (error instanceof Error && isApiOwnerMissing(error)) lifetime.abort()
    } finally {
      reading = false
      if (readAgain) {
        readAgain = false
        void read()
      } else {
        schedule()
      }
    }
  }

  const unsubscribe = subscribeApiEvent<Methods, Events, 'interactionsChanged'>(input.client, 'interactionsChanged', {
    onEvent: () => void read(),
    onStatus: status => {
      interval = status === 'live' ? liveInterval : fallbackInterval
      void read()
    },
  })
  void read()
  return () => {
    lifetime.abort()
    clearTimeout(timer)
    unsubscribe()
  }
}
