import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { useSyncExternalStore } from 'react'

/** Read one Host observable from a component; the source is stable for the registration's life. */
export const useObservable = <T>(source: ObservableSnapshot<T>): T =>
  useSyncExternalStore(
    listener => source.subscribe(listener),
    () => source.getSnapshot(),
  )
