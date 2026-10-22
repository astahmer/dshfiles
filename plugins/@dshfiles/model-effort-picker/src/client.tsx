import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { ModelEffortPicker } from './model-effort-picker.js'
import { RemoteModelDirectory } from './remote-model-directory.js'

const remoteDirectories = new WeakMap<ModelDirectory, RemoteModelDirectory>()

export default defineClientPlugin({
  id: 'dshfiles-model-effort-picker',
  uses: ['ui', 'models', 'rpc'],
  setup(api) {
    const remoteApi = api.rpc.use(multiHostApi)
    api.ui.register(
      {
        name: 'conversation.input.model',
        // Lower priority wins, so shadow the native slot at priority 0.
        priority: -1,
        inject: sessionId => {
          const directory = api.models.directoryFor(sessionId)
          const available = api.raw.ctx.sessions.subagentAddress(sessionId) === undefined
          let remoteDirectory = remoteDirectories.get(directory)
          if (remoteDirectory === undefined) {
            remoteDirectory = new RemoteModelDirectory(directory, async () => {
              const ownership = await remoteApi.sessionRuntime({ sessionId })
              if (!ownership.ok) throw new Error(`${ownership.message} (${ownership.code})`)
              if (ownership.runtimeId === null) {
                const localCatalog = await directory.load()
                return { groups: localCatalog.groups, failures: localCatalog.failures }
              }
              const catalog = await remoteApi.runtimeModels({ runtimeId: ownership.runtimeId })
              if (!catalog.ok) throw new Error(`${catalog.message} (${catalog.code})`)
              return {
                groups: catalog.groups.map(group => ({
                  id: group.id,
                  name: group.name,
                  models: group.models.map(model => ({
                    id: model.id,
                    name: model.name,
                    description: model.description ?? model.id,
                    ...(model.reasoning === undefined
                      ? {}
                      : {
                          reasoning: {
                            efforts: model.reasoning.efforts.map(effort => ({
                              id: effort.id,
                              name: effort.name,
                              description: effort.description ?? '',
                            })),
                            ...(model.reasoning.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
                          },
                        }),
                  })),
                })) satisfies ModelDirectoryState['groups'],
                failures: catalog.failures,
              }
            })
            remoteDirectories.set(directory, remoteDirectory)
          }
          const selectedDirectory = remoteDirectory
          const injected = {
            available,
            sessionId,
            directory: selectedDirectory.store,
            load: () => {
              if (!available) return
              if (remoteDirectory === undefined) directory.load().catch(() => undefined)
              else void remoteDirectory.load()
            },
            select: (selection: Parameters<typeof directory.select>[0]) => {
              if (!available) return Promise.resolve(undefined)
              return remoteDirectory === undefined ? directory.select(selection) : remoteDirectory.select(selection)
            },
          }
          return injected
        },
      },
      ModelEffortPicker,
    )
  },
})
