import { isApiOwnerMissing, type ApiClient } from '@dshfiles/dshx/api'
import { subscribeApiEvent } from '@dshfiles/dshx/client'
import type { multiHostApi, RemoteInteraction } from './api.js'

/**
 * A connected event stream announces every change, and a stream that drops reports a non-live status and reads again
 * once live, so this only covers a frame lost while the stream stayed up.
 */
const liveInterval = 60_000
/** Without the event stream this read is the feed. */
const fallbackInterval = 2_000
/** A Host that keeps failing, such as an older one that lacks the method until it restarts, is asked rarely. */
const failedInterval = 30_000

type Methods = (typeof multiHostApi)['methods']
type Events = NonNullable<(typeof multiHostApi)['events']>
type MultiHostClient = ApiClient<Methods, Events>

type Listener = {
  readonly client: MultiHostClient
  readonly onChange: (interactions: readonly RemoteInteraction[]) => void
}

/** One feed per page: multi-host's approval cards and user-questions' question cards both follow it. */
interface FeedHub {
  readonly listeners: Set<Listener>
  owner: Listener | undefined
  stop: (() => void) | undefined
  latest: readonly RemoteInteraction[] | undefined
}

// Each plugin bundles its own copy of this module, so the page-wide feed lives on globalThis.
const HUB_KEY = Symbol.for('@dshfiles/multi-host/interaction-feed')

const readFeed = (input: Listener): (() => void) => {
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
      // Turning live may have missed events; any other status only changes the cadence of the read already scheduled.
      if (status === 'live') void read()
      else if (!reading) schedule()
    },
  })
  // A stream still connecting reads once it turns live, which a boot read would only repeat; it waits at most the
  // fallback interval.
  if (timer === undefined && !reading) void read()
  return () => {
    lifetime.abort()
    clearTimeout(timer)
    unsubscribe()
  }
}

const hubOf = (): FeedHub => {
  // SAFETY: the page global is read structurally under a registered symbol only this module writes.
  const holder = globalThis as { [HUB_KEY]?: FeedHub }
  holder[HUB_KEY] ??= { listeners: new Set(), owner: undefined, stop: undefined, latest: undefined }
  return holder[HUB_KEY]
}

const startFeed = (hub: FeedHub, owner: Listener): void => {
  hub.owner = owner
  hub.stop = readFeed({
    client: owner.client,
    onChange: interactions => {
      hub.latest = interactions
      for (const listener of [...hub.listeners]) listener.onChange(interactions)
    },
  })
}

/**
 * What remote threads wait on, read once and again on each change, by one feed the whole page shares: a later
 * listener starts from the last read instead of reading again. It stops for good on a Host without multi-host. A
 * failed read reports nothing: a blip must not close a card, and the owner refuses an answer to a request that went.
 * @param input - the API client, and the listener each read reaches.
 * @returns the unsubscribe function.
 */
export const watchRemoteInteractions = (input: Listener): (() => void) => {
  const hub = hubOf()
  const listener: Listener = { client: input.client, onChange: input.onChange }
  hub.listeners.add(listener)
  if (hub.stop === undefined) startFeed(hub, listener)
  else if (hub.latest !== undefined) listener.onChange(hub.latest)
  return () => {
    hub.listeners.delete(listener)
    if (hub.owner !== listener) return
    hub.stop?.()
    hub.stop = undefined
    hub.owner = undefined
    // The feed reads through its owner's client, which leaves with its plugin: a remaining listener takes over.
    const next = hub.listeners.values().next().value
    if (next === undefined) hub.latest = undefined
    else startFeed(hub, next)
  }
}
