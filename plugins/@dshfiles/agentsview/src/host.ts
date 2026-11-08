import { homedir } from 'node:os'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Context, Duration, Effect, Layer, Path, Ref, Schedule } from 'effect'
import { agentSessionsApi } from './api.js'
import { AgentSessions, AgentSessionsConfig } from './sessions.js'

const CATCH_UP_DELAY = Duration.seconds(2)
const INDEX_INTERVAL = Duration.seconds(30)
/** How long after the last read the index stays worth catching up: a closed panel costs no background work. */
const DEMAND_WINDOW_MS = 5 * 60_000

/** Demand the Agent-sessions panel creates by reading; the indexing loop runs only inside this window. */
class PanelDemand extends Context.Service<
  PanelDemand,
  {
    readonly touch: Effect.Effect<void>
    readonly demanded: Effect.Effect<boolean>
  }
>()('@dshfiles/agentsview/PanelDemand') {
  static readonly layer = Layer.effect(
    PanelDemand,
    Effect.gen(function* () {
      const last = yield* Ref.make(0)
      return PanelDemand.of({
        touch: Ref.set(last, Date.now()),
        demanded: Ref.get(last).pipe(Effect.map(at => Date.now() - at <= DEMAND_WINDOW_MS)),
      })
    }),
  )
}

/** A read marks demand, so the catch-up loop only runs while a panel or an Agent is looking. */
const demanded = <A, E, R>(read: Effect.Effect<A, E, R>) => PanelDemand.use(demand => Effect.andThen(demand.touch, read))

const ConfigLive = Layer.unwrap(
  Effect.gen(function* () {
    const path = yield* Path.Path
    return AgentSessionsConfig.layer({
      roots: AgentSessionsConfig.defaultRoots({ home: homedir(), env: process.env, join: path.join }),
      statePath: dshHomePath('runtime', 'dshfiles', 'agentsview', 'index.json'),
    })
  }),
)

/** Index right away, then every two seconds while catching up and every 30 seconds once caught up. */
const IndexingLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* AgentSessions
    const demand = yield* PanelDemand
    yield* Effect.gen(function* () {
      if (!(yield* demand.demanded)) return true
      return (yield* sessions.pass).caughtUp
    }).pipe(
      Effect.repeat(
        Schedule.spaced(CATCH_UP_DELAY).pipe(
          Schedule.setInputType<boolean>(),
          Schedule.modifyDelay(step => Effect.succeed(step.input ? INDEX_INTERVAL : CATCH_UP_DELAY)),
        ),
      ),
      DshxPlugin.detached,
      Effect.forkScoped,
    )
  }),
)

const AgentSessionsLive = IndexingLoop.pipe(
  Layer.provideMerge(PanelDemand.layer),
  Layer.provideMerge(AgentSessions.layer),
  Layer.provide(ConfigLive),
  Layer.provide([NodeFileSystem.layer, NodePath.layer]),
)

export default DshxPlugin.make({
  name: '@dshfiles/agentsview',
  layer: AgentSessionsLive,
  apis: [
    Api.bind(agentSessionsApi, {
      sources: () => demanded(AgentSessions.use(sessions => sessions.sources)),
      list: input => demanded(AgentSessions.use(sessions => sessions.list(input))),
      read: input => demanded(AgentSessions.use(sessions => sessions.read(input))),
      search: input => demanded(AgentSessions.use(sessions => sessions.search(input))),
      stats: input => demanded(AgentSessions.use(sessions => sessions.stats(input))),
      refresh: () => AgentSessions.use(sessions => Effect.map(sessions.pass, indexing => ({ indexing }))),
    }),
  ],
})
