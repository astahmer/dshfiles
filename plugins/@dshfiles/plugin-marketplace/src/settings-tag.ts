import { Settings } from '@dshfiles/dshx/effect/settings'
import { marketplaceSettings, type MarketplaceSettings } from './settings.js'

export type { MarketplaceSettings }

export const MarketplaceSettingsTag = Settings.Tag<MarketplaceSettings>(marketplaceSettings.namespace)

/** The live settings of the `dshx-plugin-marketplace` namespace. */
export const marketplaceSettingsLayer = Settings.layer(marketplaceSettings)

/** Schema defaults with `overrides`, for tests and other callers without a Host namespace. */
export const marketplaceSettingsTestLayer = (overrides: Partial<MarketplaceSettings> = {}) =>
  Settings.layerTest<MarketplaceSettings>(marketplaceSettings.namespace, { ...marketplaceSettings.schema({}), ...overrides })
