import { Settings } from '@dshfiles/dshx/effect/settings'
import { previewSettings, type PreviewSettings } from './settings.js'

export const previewSettingsTag = Settings.Tag<PreviewSettings>(previewSettings.namespace)

/** The live `dshfiles-preview` namespace. */
export const previewSettingsLayer = Settings.layer(previewSettings)
