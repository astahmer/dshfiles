import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Effect, Layer } from 'effect'
import { annotationsSettings } from './settings.js'

type AnnotationsSettingsValue = SettingsValue<typeof annotationsSettings.schema>

export const AnnotationsSettings = Settings.Tag<AnnotationsSettingsValue>(annotationsSettings.namespace)

/** The live settings; a Host without the namespace's settings entry runs on the defaults, as the picker always did. */
export const AnnotationsSettingsLive = Settings.layer(annotationsSettings).pipe(
  Layer.catchCause(cause =>
    Layer.effectDiscard(Effect.logWarning('Annotations settings are unavailable; using defaults', cause)).pipe(
      Layer.provideMerge(Settings.layerTest<AnnotationsSettingsValue>(annotationsSettings.namespace, annotationsSettings.schema({}))),
    ),
  ),
)
