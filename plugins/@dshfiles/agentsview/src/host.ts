import { homedir } from 'node:os'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Duration, Effect, Layer, Path, Schedule } from 'effect'
import { agentSessionsApi } from './api.js'
import { AgentSessions, AgentSessionsConfig } from './sessions.js'

const CATCH_UP_DELAY = Duration.seconds(2)
const INDEX_INTERVAL = Duration.seconds(30)

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
    yield* sessions.pass.pipe(
      Effect.map(indexing => indexing.caughtUp),
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
  Layer.provideMerge(AgentSessions.layer),
  Layer.provide(ConfigLive),
  Layer.provide([NodeFileSystem.layer, NodePath.layer]),
)

export default DshxPlugin.make({
  name: '@dshfiles/agentsview',
  layer: AgentSessionsLive,
  apis: [
    Api.bind(agentSessionsApi, {
      sources: () => AgentSessions.use(sessions => sessions.sources),
      list: input => AgentSessions.use(sessions => sessions.list(input)),
      read: input => AgentSessions.use(sessions => sessions.read(input)),
      search: input => AgentSessions.use(sessions => sessions.search(input)),
      stats: input => AgentSessions.use(sessions => sessions.stats(input)),
      refresh: () => AgentSessions.use(sessions => Effect.map(sessions.pass, indexing => ({ indexing }))),
    }),
  ],
})
