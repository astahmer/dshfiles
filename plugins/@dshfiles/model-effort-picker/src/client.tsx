import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { defineClientPlugin, joinPageRead } from '@dshfiles/dshx/client'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { modelPickerLocale, MODEL_PICKER_LOCALE_NAMESPACE } from './locales.js'
import { ModelEffortPicker } from './model-effort-picker.js'
import { RemoteModelDirectory } from './remote-model-directory.js'

type RemoteModelCatalog = Pick<ModelDirectoryState, 'groups' | 'failures'>

const remoteDirectories = new WeakMap<ModelDirectory, RemoteModelDirectory>()

export default defineClientPlugin({
  id: 'dshfiles-model-effort-picker',
  uses: ['ui', 'models', 'rpc'],
  locales: [modelPickerLocale],
  setup(api) {
    const remoteApi = api.rpc.use(multiHostApi)
    api.ui.register(
      {
        name: 'conversation.input.model',
        // Lower priority wins, so shadow the native slot at priority 0.
        priority: -1,
        locale: MODEL_PICKER_LOCALE_NAMESPACE,
        inject: sessionId => {
          const directory = api.models.directoryFor(sessionId)
          const available = api.raw.ctx.sessions.subagentAddress(sessionId) === undefined
          const localCatalog = async (): Promise<RemoteModelCatalog> => {
            const loaded = await directory.load()
            return { groups: loaded.groups, failures: loaded.failures }
          }
          const remoteDirectory =
            remoteDirectories.get(directory) ??
            new RemoteModelDirectory(directory, async () => {
              // A profile without Multi-host keeps the local catalog instead of failing the whole list.
              // Multi-host's remote-host fallback reads the same owner when the Session opens; one request answers both.
              const ownership = await joinPageRead({
                key: `multi-host:sessionRuntime:${sessionId}`,
                read: () => remoteApi.sessionRuntime({ sessionId }),
              }).catch(cause => {
                if (isApiOwnerMissing(cause)) return undefined
                throw cause
              })
              if (ownership === undefined) return localCatalog()
              if (!ownership.ok) throw new Error(`${ownership.message} (${ownership.code})`)
              if (ownership.runtimeId === null) return localCatalog()
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
                    ...(model.reasoning !== undefined && {
                      reasoning: {
                        efforts: model.reasoning.efforts.map(effort => ({
                          id: effort.id,
                          name: effort.name,
                          description: effort.description ?? '',
                        })),
                        ...(model.reasoning.defaultEffort !== undefined && { defaultEffort: model.reasoning.defaultEffort }),
                      },
                    }),
                  })),
                })) satisfies ModelDirectoryState['groups'],
                failures: catalog.failures,
              }
            })
          remoteDirectories.set(directory, remoteDirectory)
          const injected = {
            available,
            sessionId,
            directory: remoteDirectory.store,
            load: () => {
              if (!available) return
              void remoteDirectory.load()
            },
            select: (selection: Parameters<typeof directory.select>[0]) => {
              if (!available) return Promise.resolve(undefined)
              return remoteDirectory.select(selection)
            },
          }
          return injected
        },
      },
      ModelEffortPicker,
    )
  },
})
