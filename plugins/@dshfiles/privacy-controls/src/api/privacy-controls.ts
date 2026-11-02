import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import type { PrivacyFeatureId } from '../features.js'

const privacyFeatureIds = [
  'answer-feedback-ui',
  'session-feedback-capture',
  'otel-session-upload',
  'deepseek-session-log-upload',
  'session-log-download',
] as const satisfies readonly [PrivacyFeatureId, ...PrivacyFeatureId[]]

const privacyFeatureIdSchema = Schema.Literals(privacyFeatureIds)

const reasonSchema = Schema.NullOr(Schema.String.check(Schema.isMaxLength(300)))

const featureStateSchema = Schema.Struct({
  feature: privacyFeatureIdSchema,
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  mixed: Schema.Boolean,
  needsRestart: Schema.Boolean,
  overridden: Schema.Boolean,
  reason: reasonSchema,
})

const controlsSnapshotSchema = Schema.Struct({
  available: Schema.Boolean,
  liveReload: Schema.Boolean,
  reason: reasonSchema,
  features: Schema.Array(featureStateSchema).check(Schema.isMinLength(5), Schema.isMaxLength(5)),
})

export type PrivacyFeatureState = typeof featureStateSchema.Type
export type PrivacyControlsSnapshot = typeof controlsSnapshotSchema.Type

export const privacyControlsApi = defineApi({
  id: 'privacy-controls',
  version: 1,
  owner: '@dshfiles/privacy-controls',
  methods: {
    read: method({
      input: Schema.Void,
      output: controlsSnapshotSchema,
      description: 'Read the effective feedback, upload, and session-log download controls for this Web profile.',
    }),
    setFeature: method({
      input: Schema.Struct({ feature: privacyFeatureIdSchema, enabled: Schema.Boolean }),
      output: controlsSnapshotSchema,
      description: 'Enable or disable one supported feedback, upload, or download feature for this Web profile.',
    }),
    setAll: method({
      input: Schema.Struct({ enabled: Schema.Boolean }),
      output: controlsSnapshotSchema,
      description: 'Enable or disable all feedback and upload features without changing session-log downloads.',
    }),
  },
})
