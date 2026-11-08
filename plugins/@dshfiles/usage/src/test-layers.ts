import { SqliteStore } from '@dshfiles/sqlite-store'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { LEGACY_USER_VERSION, usageMigrations } from './migrations.js'
import { AccountKinds } from './pricing.js'
import { UsageRepo } from './store.js'

export const PlatformTest = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** The production repo layer, opening a fresh `:memory:` database on its first read, or `filename` when given. */
export const usageRepoTest = (filename = ':memory:') => UsageRepo.layerAt(filename)

/** An eagerly opened client as well, for a test that also asserts raw rows. */
export const usageRepoTestWithSql = (filename = ':memory:') =>
  UsageRepo.layerOverClient.pipe(
    Layer.provideMerge(SqliteStore.layer({ filename, migrations: usageMigrations, legacyUserVersion: LEGACY_USER_VERSION })),
    Layer.provide(PlatformTest),
  )

/** AI Accounts is another plugin; without it every route is priced as an API key route. */
export const AccountKindsTest = Layer.succeed(AccountKinds, AccountKinds.of({ read: Effect.succeed(new Map()) }))
