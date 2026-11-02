import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

/**
 * Persisted-value storage types its schema as `ZodType`; the Effect schema is the source of truth and
 * `zodSchemaFromEffect` carries it across that boundary.
 */
/** Where the next new thread runs. Shared by every bundle that renders the destination bar. */
const destinationEffectSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({
    kind: Schema.Literal('runtime'),
    runtimeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
    /** Folder on that host; the composer stays inert until one is chosen. */
    folder: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
    /** jj options applied on the host when it runs @dshfiles/jj-integration. */
    isolate: Schema.optional(Schema.Boolean),
    base: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  }),
])
const destinationSchema = zodSchemaFromEffect(destinationEffectSchema)
export type HostDestination = Schema.Schema.Type<typeof destinationEffectSchema>

const remoteThreadRefEffectSchema = Schema.Struct({
  runtimeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
})
const remoteThreadRefSchema = zodSchemaFromEffect(Schema.NullOr(remoteThreadRefEffectSchema))
export type RemoteThreadRef = Schema.Schema.Type<typeof remoteThreadRefEffectSchema>

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
export const openRemoteThreadRef = createStoredValue({ key: 'dshfiles.multi-host.open-thread', schema: remoteThreadRefSchema, fallback: null })

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
