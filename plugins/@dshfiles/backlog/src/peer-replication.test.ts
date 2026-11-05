import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogReference } from './backlog-reference.js'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogOps } from './op-log.js'
import { BacklogPeerWire } from './peer-wire.js'
import { AutomationHost, BacklogPeers } from './peer-replication.js'
import { PeerCallFailed, PeerTransport, type PeerRead } from './peer-transport.js'
import type { BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

type Serve = (call: PeerRead, input: Schema.Json) => Effect.Effect<unknown, PeerCallFailed>
type Network = Map<string, { readonly name: string; readonly serve: Serve }>

/** One backlog Host: its store, repo and peer service, reaching other Hosts through `network` by runtime id. */
const openHost = (input: { readonly network: Network; readonly settings?: Partial<BacklogSettings> }) =>
  Effect.map(
    Layer.build(
      BacklogPeers.layer.pipe(
        Layer.provideMerge(AutomationHost.layer),
        Layer.provideMerge(PeerTransport.layerTest(input.network)),
        Layer.provideMerge(backlogStoreLayer({ settings: input.settings ?? {} })),
      ),
    ),
    context => ({ store: Context.get(context, BacklogStore), repo: Context.get(context, BacklogRepo), peers: Context.get(context, BacklogPeers) }),
  )
type Host = Effect.Success<ReturnType<typeof openHost>>

/** What a peer's backlog API answers, the way the multi-host gateway would pass it on: the same three reads, as JSON values. */
const served =
  (host: Host): Serve =>
  (call, input) =>
    Effect.gen(function* () {
      if (call === 'backlog/peerInfo') return yield* host.peers.info
      if (call === 'backlog/peerOpsSince')
        return yield* host.peers.opsSince(
          yield* Schema.decodeUnknownEffect(Schema.Struct({ cursor: Schema.Number, limit: Schema.optional(Schema.Number) }))(input).pipe(Effect.orDie),
        )
      return yield* host.peers.files(yield* Schema.decodeUnknownEffect(BacklogPeerWire.filesInputSchema)(input).pipe(Effect.orDie))
    })

const peerOn = (runtimeId: string) => ({ peers: [{ runtimeId, enabled: true }] })
const file = { id: 'shot-file-1', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 2, data: 'aGk=' }

describe('backlog peer replication between two Hosts', () => {
  it.effect('pulls the other Host’s items with their files, resumes where it stopped, and records one bounded span per pull', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      yield* TestClock.setTime(1_000)
      const network: Network = new Map()
      const a = yield* openHost({ network })
      const b = yield* openHost({ network, settings: peerOn('runtime-a') })
      network.set('runtime-a', { name: 'Studio', serve: served(a) })
      const captured = yield* a.store.capture({ text: 'shared #ops', files: [file], actor: user })
      yield* a.store.comment({ id: captured.item.id, text: 'from A', actor: user })

      const status = yield* b.peers.sync({})
      expect(status.peers).toEqual([expect.objectContaining({ runtimeId: 'runtime-a', name: 'Studio', enabled: true, lag: 0, error: null })])
      const onB = (yield* b.store.resolve(`b:${BacklogReference.refOf(captured.item)}`)) ?? 0
      const pulled = yield* b.store.get(onB)
      expect(pulled.ok && pulled.value.item.title).toBe('shared')
      expect(yield* b.store.readFile({ id: onB, attachmentId: 'shot-file-1' })).toEqual({ ok: true, value: { dataUrl: 'data:image/png;base64,aGk=' } })

      const span = recorder.span('backlog peer pull')
      expect(span.attributes['dshx.backlog.peer.ops']).toBeGreaterThan(0)
      expect(span.attributes['dshx.backlog.peer.lag']).toBe(0)
      expect(Object.keys(span.attributes).every(key => !key.includes('title') && !key.includes('body'))).toBe(true)

      yield* a.store.update({ id: captured.item.id, status: 'doing', actor: user })
      const before = (yield* b.peers.status).peers[0]?.cursor ?? 0
      yield* b.peers.sync({ runtimeId: 'runtime-a' })
      const after = (yield* b.peers.status).peers[0]
      expect(after?.cursor).toBeGreaterThan(before)
      const moved = yield* b.store.get(onB)
      expect(moved.ok && moved.value.item.status).toBe('doing')
      expect((yield* b.peers.eventHosts(onB)).events.length).toBeGreaterThan(0)
      expect((yield* b.peers.eventHosts(onB)).events.every(event => event.host === 'Studio')).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.effect('fetches a missing attachment from a peer when it is opened, and refuses bytes that do not match their hash', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(2_000)
      const network: Network = new Map()
      const a = yield* openHost({ network })
      const b = yield* openHost({ network, settings: peerOn('runtime-a') })
      const captured = yield* a.store.capture({ text: 'with a file', files: [file], actor: user })
      // Only the ops travel: B learns the attachment but not its bytes.
      const page = yield* a.peers.opsSince({ cursor: 0 })
      const records = yield* Effect.forEach(page.ops, wire =>
        Effect.map(Schema.decodeUnknownEffect(BacklogOps.json)(wire.op), op => ({
          opId: wire.opId,
          itemId: wire.itemId,
          hlc: wire.hlc,
          origin: wire.origin,
          op,
        })),
      )
      yield* b.store.ingestPeerOps(records)
      const onB = (yield* b.store.resolve(`b:${BacklogReference.refOf(captured.item)}`)) ?? 0
      expect(onB).toBeGreaterThan(0)
      expect((yield* b.store.readFile({ id: onB, attachmentId: 'shot-file-1' })).ok).toBe(false)

      network.set('runtime-a', {
        name: 'Studio',
        serve: (call, input) =>
          call === 'backlog/peerFiles'
            ? Effect.map(served(a)(call, input), answer => {
                const files = Schema.decodeUnknownSync(BacklogPeerWire.filesOutputSchema)(answer).files
                return { files: files.map(entry => ({ ...entry, data: 'dGFtcGVyZWQ=' })), missing: [] }
              })
            : served(a)(call, input),
      })
      expect(yield* b.peers.fetchFile({ id: onB, attachmentId: 'shot-file-1' })).toBe(false)
      expect((yield* b.store.readFile({ id: onB, attachmentId: 'shot-file-1' })).ok).toBe(false)

      network.set('runtime-a', { name: 'Studio', serve: served(a) })
      expect(yield* b.peers.fetchFile({ id: onB, attachmentId: 'shot-file-1' })).toBe(true)
      expect(yield* b.store.readFile({ id: onB, attachmentId: 'shot-file-1' })).toEqual({ ok: true, value: { dataUrl: 'data:image/png;base64,aGk=' } })
    }),
  )

  it.effect('refuses a Host with a newer op schema, skips an offline one, and catches up once it answers', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(3_000)
      const network: Network = new Map()
      const a = yield* openHost({ network })
      const b = yield* openHost({ network, settings: peerOn('runtime-a') })
      yield* a.store.capture({ text: 'only on A', actor: user })

      network.set('runtime-a', {
        name: 'Studio',
        serve: (call, input) =>
          call === 'backlog/peerInfo' ? Effect.map(a.peers.info, info => ({ ...info, opSchema: info.opSchema + 1 })) : served(a)(call, input),
      })
      const refused = (yield* b.peers.sync({})).peers[0]
      expect(refused?.error?.code).toBe('incompatible-ops')
      expect(refused?.error?.message).toContain('Update this Host')
      expect((yield* b.store.list({ freshness: 'all', limit: 10 })).items).toHaveLength(0)

      network.set('runtime-a', { name: 'Studio', serve: () => Effect.fail(new PeerCallFailed({ code: 'gateway-unreachable', detail: 'offline' })) })
      const offline = (yield* b.peers.sync({})).peers[0]
      expect(offline?.error?.code).toBe('gateway-unreachable')
      expect(offline?.error?.message).toContain('caught up on a later pull')

      network.set('runtime-a', { name: 'Studio', serve: served(a) })
      const back = (yield* b.peers.sync({})).peers[0]
      expect(back?.error).toBeNull()
      expect((yield* b.store.list({ freshness: 'all', limit: 10 })).items.map(item => item.title)).toEqual(['only on A'])
    }),
  )

  it.effect('pulls nothing until a peer is turned on, and turning it off keeps what was pulled', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(4_000)
      const network: Network = new Map()
      const a = yield* openHost({ network })
      const b = yield* openHost({ network })
      network.set('runtime-a', { name: 'Studio', serve: served(a) })
      yield* a.store.capture({ text: 'from A', actor: user })
      const idle = yield* b.peers.sync({})
      expect(idle.peers).toEqual([expect.objectContaining({ runtimeId: 'runtime-a', enabled: false, pulled: 0 })])
      yield* b.peers.configure({ peers: [{ runtimeId: 'runtime-a', enabled: true }] })
      yield* b.peers.sync({})
      const off = yield* b.peers.configure({ peers: [{ runtimeId: 'runtime-a', enabled: false }] })
      expect(off.peers[0]?.enabled).toBe(false)
      expect((yield* b.store.list({ freshness: 'all', limit: 10 })).items.map(item => item.title)).toEqual(['from A'])
    }),
  )

  it.effect('runs gate checks and main polling on one chosen Host, and says so on the others', () =>
    Effect.gen(function* () {
      const network: Network = new Map()
      const alone = yield* openHost({ network })
      expect(yield* Effect.map(alone.peers.status, status => [status.automationHere, status.automationNote])).toEqual([true, null])

      const undecided = yield* openHost({ network, settings: peerOn('runtime-a') })
      const pending = yield* undecided.peers.status
      expect(pending.automationHere).toBe(true)
      expect(pending.automationNote).toContain('Pick one Host')

      const elsewhere = yield* undecided.peers.configure({ automationHost: 'another-host-id' })
      expect(elsewhere.automationHere).toBe(false)
      expect(elsewhere.automationNote).toContain('this Host skips them')

      const back = yield* undecided.peers.configure({ automationHost: undecided.repo.hostId })
      expect([back.automationHere, back.automationHostId]).toEqual([true, null])
    }),
  )
})
