import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Layer } from 'effect'
import { promptStashApi } from './library-api.js'
import { PromptHistoryService } from './prompt-history.js'
import { promptStashSettings } from './settings.js'
import { PromptStash } from './store.js'

export default DshxPlugin.make({
  name: '@dshfiles/prompt-stash',
  inject: ['storageDomain'],
  settings: [promptStashSettings],
  layer: Layer.mergeAll(
    PromptStash.layer.pipe(Layer.provide(StorageDomain.layer)),
    PromptHistoryService.layer.pipe(Layer.provide(Layer.merge(HostApis.layer, Settings.layer(promptStashSettings)))),
  ),
  apis: [
    Api.bind(promptStashApi, {
      state: () => PromptStash.use(stash => stash.snapshot),
      save: input => PromptStash.use(stash => stash.save(input)),
      remove: input => PromptStash.use(stash => stash.remove(input)),
      history: input => PromptHistoryService.use(history => history.search(input)),
    }),
  ],
})
