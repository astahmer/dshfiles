import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { HostDirectory, JobTracker } from './host-edge-promise.js'
import { ProcessProbe, ProcessStopper } from './process-probe.js'
import { SessionMetadata } from './session-metadata-cache.js'

/** The Host Session controller and job registry are external to the plugin; the processes and `ps` are real. */
const hostFakes = Layer.mergeAll(
  Layer.succeed(HostDirectory, HostDirectory.of({ sessions: Effect.succeed([]), workspaces: Effect.succeed([]) })),
  Layer.succeed(JobTracker, JobTracker.of({ running: Effect.succeed([]), kill: () => Effect.succeed(false) })),
)

const probeLayer = ProcessStopper.layer.pipe(
  Layer.provideMerge(ProcessProbe.layer),
  Layer.provide(SessionMetadata.layer),
  Layer.provide(Layer.merge(hostFakes, NodeServices.layer)),
)

const supported = process.platform === 'darwin' || process.platform === 'linux'

describe.runIf(supported)('ProcessProbe', () => {
  it.layer(probeLayer)(layer => {
    layer.effect('serves one probe within the TTL and probes again when fresh', () =>
      Effect.gen(function* () {
        const probe = yield* ProcessProbe
        yield* TestClock.setTime(10_000)
        const first = yield* probe.snapshot({ fresh: false })
        expect(first.supported).toBe(true)
        expect(first.hostBytes).toBeGreaterThan(0)
        yield* TestClock.adjust(1_000)
        expect((yield* probe.snapshot({ fresh: false })).takenAt).toBe(first.takenAt)
        expect((yield* probe.snapshot({ fresh: true })).takenAt).toBe(11_000)
      }),
    )

    layer.effect('refuses a target the snapshot does not list', () =>
      Effect.gen(function* () {
        const stopper = yield* ProcessStopper
        const result = yield* stopper.stop([{ pid: process.pid, startedAt: 0 }])
        expect(result).toEqual({ stopped: 0, viaJob: 0, missing: 0, refused: 1 })
      }),
    )
  })
})
