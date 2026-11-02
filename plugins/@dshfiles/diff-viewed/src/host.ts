import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Layer } from 'effect'
import { diffViewedApi } from './marks-api.js'
import { ViewedMarks } from './marks-store.js'

export default DshxPlugin.make({
  name: '@dshfiles/diff-viewed',
  inject: ['storageDomain'],
  layer: ViewedMarks.layer.pipe(Layer.provide(StorageDomain.layer)),
  apis: [
    Api.bind(diffViewedApi, {
      state: () => ViewedMarks.use(marks => marks.snapshot),
      toggle: input => ViewedMarks.use(marks => marks.toggle(input)),
    }),
  ],
})
