import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Layer } from 'effect'
import { promptStashApi } from './library-api.js'
import { PromptStash } from './store.js'

export default DshxPlugin.make({
  name: '@dshfiles/prompt-stash',
  inject: ['storageDomain'],
  layer: PromptStash.layer.pipe(Layer.provide(StorageDomain.layer)),
  apis: [
    Api.bind(promptStashApi, {
      state: () => PromptStash.use(stash => stash.snapshot),
      save: input => PromptStash.use(stash => stash.save(input)),
      remove: input => PromptStash.use(stash => stash.remove(input)),
    }),
  ],
})
