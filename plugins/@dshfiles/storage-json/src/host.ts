/**
 * Loader row entry for the owned JSON backend fork: the upstream plugin module
 * exports `apply`/`name`/`inject`/`Config` unchanged, so the row loads it with
 * the same `root` config as the stock row it replaces.
 * @module @dshfiles/storage-json
 */

export { apply, Config, inject, name } from './native/index.ts'
export { JsonStorageBackend } from './native/index.ts'
