import { DshxPlugin } from '@dshfiles/dshx/effect'
import type { SettingsConflict, SettingsWriteFailed } from '@dshfiles/dshx/effect/settings'
import { Cause, Clock, Context, Duration, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import type { BacklogPeerStatusView } from './api.js'
import { backlogMigrations } from './backlog-db.js'
import { BacklogRepo, type PeerState } from './backlog-repo.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import type { BacklogAttachment } from './item.js'
import { BacklogOps, type BacklogOpRecord } from './op-log.js'
import { BacklogPeerWire, type PeerFileKey, type PeerFiles, type PeerInfo, type PeerOpsPage } from './peer-wire.js'
import { PeerCallFailed, PeerTransport, type PeerRuntime } from './peer-transport.js'
import { BacklogStore } from './store.js'

const PAGE_LIMIT = 500
const PAGE_BYTES = 4_000_000
/** One pull takes at most this many pages; the rest waits for the next pull, so one huge log never holds the worker. */
const PAGES_PER_PULL = 40
const FILE_BYTES_PER_CALL = 16 * 1024 * 1024
const FILES_PER_CALL = 16
/** Attachment bytes fetched ahead after each pass, so a Host further down a chain can get them from this one. */
const PREFETCH_PER_PASS = 32
/** Peers pulled at once: their pages queue on the store's one write permit anyway, so more only adds sockets. */
const PEER_CONCURRENCY = 2

const decodeInfo = Schema.decodeUnknownEffect(BacklogPeerWire.infoSchema)
const decodePage = Schema.decodeUnknownEffect(BacklogPeerWire.opsPageSchema)
const decodeFiles = Schema.decodeUnknownEffect(BacklogPeerWire.filesOutputSchema)
const decodeOp = Schema.decodeUnknownEffect(BacklogOps.json)

/** Why one pull stopped, with what the user can do about it. */
class PeerPullStopped extends Schema.TaggedError<PeerPullStopped>()('PeerPullStopped', {
  code: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail
  }
}

const updateHint = 'Update the older Host (Hosts panel › Update hosts, or the multi_host_update tool), restart it, then sync again.'

/** A peer this Host cannot read ops from, or null when it can. */
const incompatibility = (info: PeerInfo, hostId: string): PeerPullStopped | null => {
  if (info.hostId === hostId)
    return new PeerPullStopped({ code: 'same-host', detail: 'That runtime is this Host itself. Turn it off here; it has nothing to pull.' })
  if (info.protocol !== BacklogPeerWire.protocol)
    return new PeerPullStopped({
      code: 'incompatible-protocol',
      detail: `That Host speaks backlog peer protocol ${String(info.protocol)}, this one ${String(BacklogPeerWire.protocol)}. ${updateHint}`,
    })
  if (info.opSchema > BacklogOps.schemaVersion)
    return new PeerPullStopped({
      code: 'incompatible-ops',
      detail: `That Host writes backlog ops of schema ${String(info.opSchema)}; this Host reads up to ${String(BacklogOps.schemaVersion)}. Update this Host's backlog plugin and restart it, then sync again.`,
    })
  return null
}

/** A failed peer read in the words the Hosts panel shows: what happened and what to do. */
const stoppedBy = (error: PeerCallFailed): PeerPullStopped => {
  if (error.code === 'api-not-served')
    return new PeerPullStopped({ code: error.code, detail: 'That Host does not serve the backlog. Enable @dshfiles/backlog there, or turn this peer off.' })
  if (error.code === 'multi-host-unavailable')
    return new PeerPullStopped({
      code: error.code,
      detail: `Multi-host could not reach that runtime (${error.detail}). Update @dshfiles/multi-host on this Host if it predates peer reads.`,
    })
  return new PeerPullStopped({
    code: error.code,
    detail: `That Host did not answer (${error.code}). It is skipped and caught up on a later pull; check it in the Hosts panel.`,
  })
}

const recordsOf = (page: PeerOpsPage) =>
  Effect.forEach(page.ops, wire =>
    decodeOp(wire.op).pipe(
      Effect.map((op): BacklogOpRecord => ({ opId: wire.opId, itemId: wire.itemId, hlc: wire.hlc, origin: wire.origin, op })),
      Effect.mapError(
        () =>
          new PeerPullStopped({
            code: 'unreadable-op',
            detail: `An op from that Host does not match this Host's op schema, so none of the page was stored. ${updateHint}`,
          }),
      ),
    ),
  )

const emptyState = (runtimeId: string): PeerState => ({
  runtimeId,
  remoteHostId: null,
  cursor: 0,
  head: 0,
  pulled: 0,
  lastPullAt: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  lastError: null,
})

/** Where background automation runs once Hosts share the backlog, and whether it runs here. */
export class AutomationHost extends Context.Service<
  AutomationHost,
  {
    readonly here: Effect.Effect<boolean>
    readonly view: Effect.Effect<{ readonly automationHostId: string | null; readonly here: boolean; readonly note: string | null }>
  }
>()('@dshfiles/backlog/AutomationHost') {
  static readonly layer = Layer.effect(
    AutomationHost,
    Effect.gen(function* () {
      const repo = yield* BacklogRepo
      const settings = yield* BacklogSettingsTag
      const view = Effect.map(settings.get, current => {
        const chosen = current.automationHost.trim()
        const sharing = current.peers.some(peer => peer.enabled)
        if (chosen !== '' && chosen !== repo.hostId)
          return {
            automationHostId: chosen,
            here: false,
            note: `Gate checks and main polling run on Host ${chosen.slice(0, 8)}; this Host skips them. Pick this Host in Backlog settings › Hosts to move them here.`,
          }
        return {
          automationHostId: chosen === '' ? null : chosen,
          here: true,
          note:
            sharing && chosen === ''
              ? 'Every Host that shares the backlog runs gate checks and main polling until you pick one, so their events repeat. Pick one Host here.'
              : null,
        }
      })
      return AutomationHost.of({ here: Effect.map(view, current => current.here), view })
    }),
  )

  static readonly layerHere = Layer.succeed(
    AutomationHost,
    AutomationHost.of({ here: Effect.succeed(true), view: Effect.succeed({ automationHostId: null, here: true, note: null }) }),
  )
}

/**
 * Backlog replication across Hosts: this Host serves its op log (every op it holds, whoever wrote it) to peers, and pulls
 * each enabled multi-host runtime's log after the cursor it reached. Ops form a grow-only set and fold in one total order,
 * so any topology converges and an offline Host catches up later. Connections, bindings, sync state, leases and peer
 * state stay local: they never enter the op log.
 */
export class BacklogPeers extends Context.Service<
  BacklogPeers,
  {
    readonly info: Effect.Effect<PeerInfo>
    readonly opsSince: (input: { readonly cursor: number; readonly limit?: number | undefined }) => Effect.Effect<PeerOpsPage>
    readonly files: (input: { readonly files: readonly PeerFileKey[] }) => Effect.Effect<PeerFiles>
    readonly status: Effect.Effect<BacklogPeerStatusView>
    readonly sync: (input: { readonly runtimeId?: string | undefined }) => Effect.Effect<BacklogPeerStatusView>
    readonly configure: (input: {
      readonly peers?: readonly { readonly runtimeId: string; readonly enabled: boolean }[] | undefined
      readonly automationHost?: string | undefined
    }) => Effect.Effect<BacklogPeerStatusView, SettingsConflict | SettingsWriteFailed>
    /** Fetches one attachment's bytes from an enabled peer; true once this Host has them. */
    readonly fetchFile: (input: { readonly id: number; readonly attachmentId: string }) => Effect.Effect<boolean>
    /** Which other Host wrote each of an item's events. */
    readonly eventHosts: (id: number) => Effect.Effect<{ readonly events: readonly { readonly at: number; readonly actor: string; readonly host: string }[] }>
  }
>()('@dshfiles/backlog/BacklogPeers') {
  static readonly layer = Layer.effect(
    BacklogPeers,
    Effect.gen(function* () {
      const repo = yield* BacklogRepo
      const store = yield* BacklogStore
      const settings = yield* BacklogSettingsTag
      const transport = yield* PeerTransport
      const automation = yield* AutomationHost
      const pulling = yield* Semaphore.make(1)
      /** The automation Host each peer reported on its last pull, so a disagreement between Hosts shows. */
      const reportedAutomation = yield* Ref.make<ReadonlyMap<string, string | null>>(new Map())

      const info = Effect.map(automation.view, (view): PeerInfo => ({
        hostId: repo.hostId,
        protocol: BacklogPeerWire.protocol,
        opSchema: BacklogOps.schemaVersion,
        dbSchema: Object.keys(backlogMigrations).length,
        automationHostId: view.automationHostId,
      }))

      const opsSince = Effect.fn('backlog peer serve ops')(function* (input: { readonly cursor: number; readonly limit?: number | undefined }) {
        const limit = Math.min(Math.max(1, input.limit ?? PAGE_LIMIT), 2_000)
        const page = yield* repo.opsSince({ cursor: input.cursor, limit, maxBytes: PAGE_BYTES }).pipe(Effect.orDie)
        const last = page.ops.length === 0 ? input.cursor : (page.ops[page.ops.length - 1]?.seq ?? input.cursor)
        return { hostId: repo.hostId, head: page.head, more: last < page.head, ops: page.ops }
      })

      const files = Effect.fn('backlog peer serve files')(function* (input: { readonly files: readonly PeerFileKey[] }) {
        const found: PeerFiles['files'][number][] = []
        const missing: PeerFileKey[] = []
        const budget = { bytes: 0 }
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- reads stop once the reply reaches its byte budget.
        for (const key of input.files.slice(0, FILES_PER_CALL)) {
          if (found.length > 0 && budget.bytes >= FILE_BYTES_PER_CALL) break
          const blob = yield* repo.blobOf(key).pipe(Effect.orDie)
          if (Option.isNone(blob)) {
            missing.push(key)
            continue
          }
          budget.bytes += blob.value.data.length
          found.push({ ...key, ...blob.value })
        }
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.peer.files': found.length, 'dshx.backlog.peer.missing': missing.length })
        return { files: found, missing }
      })

      const stateOf = (runtimeId: string) =>
        Effect.map(repo.peerStates.pipe(Effect.orDie), states => states.find(state => state.runtimeId === runtimeId) ?? emptyState(runtimeId))

      /** Pulls one runtime's ops after its cursor, page by page, saving the cursor after each stored page. */
      const pullOne = Effect.fn('backlog peer pull')(function* (runtimeId: string) {
        const started = yield* Clock.currentTimeMillis
        const before = yield* stateOf(runtimeId)
        const progress = { state: { ...before, lastPullAt: started } }
        const run = Effect.gen(function* () {
          const info = yield* transport.read({ runtimeId, call: 'backlog/peerInfo', input: null }).pipe(
            Effect.mapError(stoppedBy),
            Effect.flatMap(raw =>
              decodeInfo(raw).pipe(
                Effect.mapError(
                  () => new PeerPullStopped({ code: 'invalid-response', detail: `That Host's backlog answered in an unknown shape. ${updateHint}` }),
                ),
              ),
            ),
          )
          yield* Ref.update(reportedAutomation, current => new Map(current).set(runtimeId, info.automationHostId ?? info.hostId))
          const refused = incompatibility(info, repo.hostId)
          if (refused !== null) return yield* refused
          const cursor = info.hostId === before.remoteHostId ? before.cursor : 0
          progress.state = { ...progress.state, remoteHostId: info.hostId, cursor }
          for (let index = 0; index < PAGES_PER_PULL; index += 1) {
            const page = yield* transport.read({ runtimeId, call: 'backlog/peerOpsSince', input: { cursor: progress.state.cursor, limit: PAGE_LIMIT } }).pipe(
              Effect.mapError(stoppedBy),
              Effect.flatMap(raw =>
                decodePage(raw).pipe(
                  Effect.mapError(
                    () => new PeerPullStopped({ code: 'invalid-response', detail: `That Host's backlog answered in an unknown shape. ${updateHint}` }),
                  ),
                ),
              ),
            )
            if (page.hostId !== info.hostId)
              return yield* new PeerPullStopped({ code: 'host-changed', detail: 'That runtime now runs another backlog. Sync again to start over.' })
            const ingested = yield* store.ingestPeerOps(yield* recordsOf(page))
            const reached = page.ops.length === 0 ? progress.state.cursor : (page.ops[page.ops.length - 1]?.seq ?? progress.state.cursor)
            progress.state = { ...progress.state, cursor: reached, head: page.head, pulled: progress.state.pulled + ingested.inserted }
            yield* repo.putPeerState(progress.state).pipe(Effect.orDie)
            if (!page.more) break
          }
          return info
        })
        const outcome = yield* Effect.result(run)
        const finished = yield* Clock.currentTimeMillis
        const pulled = progress.state.pulled - before.pulled
        yield* Effect.annotateCurrentSpan({
          'dshx.backlog.peer.ops': pulled,
          'dshx.backlog.peer.lag': Math.max(0, progress.state.head - progress.state.cursor),
        })
        const failure =
          outcome._tag === 'Failure'
            ? outcome.failure._tag === 'PeerPullStopped'
              ? outcome.failure
              : new PeerPullStopped({ code: 'store-failed', detail: outcome.failure.message })
            : null
        yield* Effect.annotateCurrentSpan({ 'multi_host.outcome': failure === null ? 'ok' : failure.code })
        yield* repo
          .putPeerState({
            ...progress.state,
            lastSuccessAt: failure === null ? finished : before.lastSuccessAt,
            lastErrorCode: failure === null ? null : failure.code,
            lastError: failure === null ? null : failure.detail.slice(0, 1_000),
          })
          .pipe(Effect.orDie)
        return failure === null
      })

      const enabledRuntimes = Effect.map(settings.get, current => current.peers.filter(peer => peer.enabled).map(peer => peer.runtimeId))

      /** An attachment one of this Host's items names, with the canonical id a peer knows its item by. */
      const attachmentOf = Effect.fnUntraced(function* (input: { readonly id: number; readonly attachmentId: string }) {
        const found = yield* store.get(input.id)
        if (!found.ok) return null
        const item = found.value.item
        const attachment: BacklogAttachment | undefined = [...item.attachments, ...item.events.flatMap(event => event.attachments ?? [])].find(
          candidate => candidate.id === input.attachmentId,
        )
        const itemId = yield* repo.canonicalId(input.id)
        return attachment === undefined || Option.isNone(itemId) ? null : { attachment, itemId: itemId.value }
      })

      /** Asks enabled peers, in order, for these attachments and stores every answer whose bytes match its SHA-256. */
      const fetchFrom = Effect.fnUntraced(function* (
        wanted: readonly { readonly id: number; readonly itemId: string; readonly attachment: BacklogAttachment }[],
      ) {
        const left = new Map(wanted.map(entry => [`${entry.itemId}:${entry.attachment.id}`, entry] as const))
        for (const runtimeId of yield* enabledRuntimes) {
          if (left.size === 0) break
          const keys = [...left.values()].slice(0, FILES_PER_CALL).map(entry => ({ itemId: entry.itemId, attachmentId: entry.attachment.id }))
          const answer = yield* transport
            .read({ runtimeId, call: 'backlog/peerFiles', input: { files: keys } })
            .pipe(Effect.flatMap(decodeFiles), Effect.option)
          if (Option.isNone(answer)) continue
          for (const file of answer.value.files) {
            const entry = left.get(`${file.itemId}:${file.attachmentId}`)
            if (entry === undefined) continue
            const stored = yield* repo
              .storeFetchedFile({ itemId: entry.id, attachment: entry.attachment, sha256: file.sha256, data: file.data })
              .pipe(Effect.orElseSucceed(() => false))
            if (stored) left.delete(`${file.itemId}:${file.attachmentId}`)
          }
        }
        return wanted.length - left.size
      })

      const fetchFile = Effect.fn('backlog peer fetch file')(function* (input: { readonly id: number; readonly attachmentId: string }) {
        const wanted = yield* attachmentOf(input)
        if (wanted === null) return false
        return (yield* fetchFrom([{ id: input.id, ...wanted }])) > 0
      })

      /** Attachments of live items this Host has no bytes for yet, fetched ahead a few at a time. */
      const prefetch = Effect.fn('backlog peer prefetch files')(function* () {
        const have = yield* repo.attachmentKeys.pipe(Effect.orDie)
        const listed = (yield* store.list({ freshness: 'all', limit: 2_000 })).items
        const wanted: { readonly id: number; readonly itemId: string; readonly attachment: BacklogAttachment }[] = []
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- stops at the per-pass budget, reading items only until it is reached.
        for (const summary of listed) {
          if (wanted.length >= PREFETCH_PER_PASS) break
          if (summary.attachments.every(attachment => have.has(`${String(summary.id)}:${attachment.id}`))) continue
          const found = yield* store.get(summary.id)
          if (!found.ok) continue
          const itemId = yield* repo.canonicalId(summary.id)
          if (Option.isNone(itemId)) continue
          for (const attachment of [...found.value.item.attachments, ...found.value.item.events.flatMap(event => event.attachments ?? [])])
            if (!have.has(`${String(summary.id)}:${attachment.id}`) && wanted.length < PREFETCH_PER_PASS)
              wanted.push({ id: summary.id, itemId: itemId.value, attachment })
        }
        if (wanted.length === 0) return 0
        const fetched = yield* fetchFrom(wanted)
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.peer.files': fetched, 'dshx.backlog.peer.missing': wanted.length - fetched })
        return fetched
      })

      const pullAll = (only?: string) =>
        pulling.withPermits(1)(
          Effect.gen(function* () {
            if (!(yield* transport.available)) return
            const enabled = yield* enabledRuntimes
            const targets = only === undefined ? enabled : enabled.filter(runtimeId => runtimeId === only)
            if (targets.length === 0) return
            yield* Effect.forEach(targets, pullOne, { concurrency: PEER_CONCURRENCY, discard: true })
            yield* prefetch()
          }),
        )

      const status = Effect.gen(function* () {
        const available = yield* transport.available
        const runtimes: readonly PeerRuntime[] = available ? yield* transport.runtimes.pipe(Effect.orElseSucceed((): readonly PeerRuntime[] => [])) : []
        const current = yield* settings.get
        const states = yield* repo.peerStates.pipe(Effect.orDie)
        const view = yield* automation.view
        const known = new Set(runtimes.map(runtime => runtime.runtimeId))
        const listed = [
          ...runtimes,
          ...current.peers.filter(peer => !known.has(peer.runtimeId)).map(peer => ({ runtimeId: peer.runtimeId, name: peer.runtimeId, connected: false })),
        ]
        const remoteAutomation = yield* Ref.get(reportedAutomation)
        return {
          available,
          hostId: repo.hostId,
          intervalSeconds: current.peerPullSeconds,
          automationHostId: view.automationHostId,
          automationHere: view.here,
          automationNote: view.note,
          peers: listed.map(runtime => {
            const state = states.find(candidate => candidate.runtimeId === runtime.runtimeId) ?? emptyState(runtime.runtimeId)
            return {
              runtimeId: runtime.runtimeId,
              name: runtime.name,
              connected: runtime.connected,
              enabled: current.peers.some(peer => peer.runtimeId === runtime.runtimeId && peer.enabled),
              remoteHostId: state.remoteHostId,
              cursor: state.cursor,
              lag: Math.max(0, state.head - state.cursor),
              pulled: state.pulled,
              lastPullAt: state.lastPullAt,
              lastSuccessAt: state.lastSuccessAt,
              automationHostId: remoteAutomation.get(runtime.runtimeId) ?? null,
              error: state.lastErrorCode === null ? null : { code: state.lastErrorCode, message: state.lastError ?? '' },
            }
          }),
        } satisfies BacklogPeerStatusView
      })

      const configure = Effect.fn('backlog peers configure')(function* (input: {
        readonly peers?: readonly { readonly runtimeId: string; readonly enabled: boolean }[] | undefined
        readonly automationHost?: string | undefined
      }) {
        const current = yield* settings.get
        const changes = input.peers ?? []
        const kept = current.peers.filter(peer => !changes.some(change => change.runtimeId === peer.runtimeId))
        yield* settings.update({
          peers: [...kept, ...changes.map(change => ({ runtimeId: change.runtimeId, enabled: change.enabled }))],
          ...(input.automationHost !== undefined && { automationHost: input.automationHost.trim() === repo.hostId ? '' : input.automationHost.trim() }),
        })
        return yield* status
      })

      const eventHosts = Effect.fn('backlog peer event hosts')(function* (id: number) {
        const records = yield* repo.opsOf(id).pipe(Effect.orElseSucceed((): readonly BacklogOpRecord[] => []))
        const remote = records.filter(record => record.hlc.host !== repo.hostId)
        if (remote.length === 0) return { events: [] }
        const states = yield* repo.peerStates.pipe(Effect.orElseSucceed((): readonly PeerState[] => []))
        const runtimes = yield* transport.runtimes.pipe(Effect.orElseSucceed((): readonly PeerRuntime[] => []))
        const labelOf = (host: string): string => {
          const runtimeId = states.find(state => state.remoteHostId === host)?.runtimeId
          return runtimes.find(runtime => runtime.runtimeId === runtimeId)?.name ?? `Host ${host.slice(0, 8)}`
        }
        return {
          events: remote.flatMap(record => {
            const op = record.op
            const event =
              op.kind === 'event' || op.kind === 'comment' || op.kind === 'comment-edit' || op.kind === 'rename-ref'
                ? op.event
                : op.kind === 'create'
                  ? op.event
                  : undefined
            return event === undefined ? [] : [{ at: event.at, actor: event.actor, host: labelOf(record.hlc.host) }]
          }),
        }
      })

      return BacklogPeers.of({
        info,
        opsSince,
        files,
        status,
        sync: input => Effect.andThen(pullAll(input.runtimeId), status),
        configure,
        fetchFile,
        eventHosts,
      })
    }),
  )

  /** Pulls every enabled peer on the configured interval; nothing runs while no peer is on or multi-host is absent. */
  static readonly loop = Layer.effectDiscard(
    Effect.gen(function* () {
      const peers = yield* BacklogPeers
      const settings = yield* BacklogSettingsTag
      const tick = peers.sync({}).pipe(
        Effect.asVoid,
        Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning('backlog peer pull failed', cause))),
      )
      const wait = Effect.flatMap(settings.get, current => Effect.sleep(Duration.seconds(current.peerPullSeconds)))
      yield* DshxPlugin.worker(Effect.sleep('15 seconds').pipe(Effect.andThen(Effect.forever(Effect.andThen(tick, wait)))))
    }),
  )
}
