import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z as storedValueZod } from 'zod'

/** Persisted-value storage is ZodType-only; keep this boundary on Zod until that API changes. */
/** Where the next new thread runs. Shared by every bundle that renders the destination bar. */
const destinationSchema = storedValueZod.discriminatedUnion('kind', [
  storedValueZod.object({ kind: storedValueZod.literal('local') }),
  storedValueZod.object({
    kind: storedValueZod.literal('runtime'),
    runtimeId: storedValueZod.string().min(1).max(64),
    /** Folder on that host; the composer stays inert until one is chosen. */
    folder: storedValueZod.string().min(1).max(4096).optional(),
    /** jj options applied on the host when it runs @dshfiles/jj-integration. */
    isolate: storedValueZod.boolean().optional(),
    base: storedValueZod.string().min(1).max(256).optional(),
  }),
])
export type HostDestination = storedValueZod.infer<typeof destinationSchema>

const remoteThreadRefSchema = storedValueZod.object({ runtimeId: storedValueZod.string().min(1).max(64), sessionId: storedValueZod.string().min(1).max(256) })
export type RemoteThreadRef = storedValueZod.infer<typeof remoteThreadRefSchema>

/** The `main` panel key of the remote thread view, selected with `layout.selectPanel`. */
export const REMOTE_THREAD_PANEL = 'dshfiles-multi-host-thread'

/** The `main` panel key of the dedicated Hosts page, selected with `layout.selectPanel`. */
export const HOSTS_PANEL_ID = 'dshfiles-multi-host-hosts'

/** Asks the multi-host bundle to open its Hosts page; dispatch it from anywhere, e.g. the host chip. */
export const OPEN_HOSTS_EVENT = 'dshfiles:open-hosts'

export const openHostsPage = (): void => {
  globalThis.dispatchEvent?.(new Event(OPEN_HOSTS_EVENT))
}

const changedEvent = 'dshfiles:multi-host:destination-changed'

const local: HostDestination = { kind: 'local' }
export const hostDestination = createStoredValue({ key: 'dshfiles.multi-host.destination', schema: destinationSchema, fallback: local })
export const openRemoteThreadRef = createStoredValue({ key: 'dshfiles.multi-host.open-thread', schema: remoteThreadRefSchema.nullable(), fallback: null })

// Each plugin bundle compiles its own copy of this module; the storage event only crosses tabs, so a same-page event
// keeps the copies in step.
globalThis.addEventListener?.(changedEvent, () => {
  hostDestination.reload()
  openRemoteThreadRef.reload()
})
const announce = (): void => void globalThis.dispatchEvent?.(new Event(changedEvent))

export const setHostDestination = (next: HostDestination): void => {
  hostDestination.set(next)
  announce()
}

/** Which remote thread the `main` panel shows; no thread selected means the panel lists every one. */
export class RemoteThreadSelection {
  static open(ref: RemoteThreadRef): void {
    openRemoteThreadRef.set(ref)
    announce()
  }
  /** Back to the panel's own list of every thread on every host. */
  static clear(): void {
    openRemoteThreadRef.set(null)
    announce()
  }
}
