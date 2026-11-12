import { useApiEvent } from '@dshfiles/dshx/client'
import { useQueryClient } from '@dshfiles/plugin-ui/query'
import { multiHostApi } from '../api.js'
import { multiHostKeys } from './queries.js'

/** While the event stream is live a change arrives as an event; this only covers a directory another process wrote. */
const LIVE_INTERVAL_MS = 5 * 60_000

/** How often the host directory and the threads started here are asked again, with and without the change events. */
export class InventoryPoll {
  static interval(input: { readonly eventsLive: boolean; readonly intervalMs: number }): number {
    return input.eventsLive ? Math.max(input.intervalMs, LIVE_INTERVAL_MS) : input.intervalMs
  }

  /** Reads the directory and the thread list again on each `inventoryChanged` event; returns the interval to poll them at. */
  static use(intervalMs: number): number {
    const queryClient = useQueryClient()
    const events = useApiEvent(multiHostApi, 'inventoryChanged', () => {
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.directory })
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.threads })
    })
    return InventoryPoll.interval({ eventsLive: events === 'live', intervalMs })
  }
}
