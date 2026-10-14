import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import type { PrivacyFeatureId } from '../features.js'

const privacyFeatureIds = [
  'answer-feedback-ui',
  'session-feedback-capture',
  'otel-session-upload',
  'deepseek-session-log-upload',
  'session-log-download',
] as const satisfies readonly [PrivacyFeatureId, ...PrivacyFeatureId[]]

const privacyFeatureIdSchema = z.enum(privacyFeatureIds)

const featureStateSchema = z.object({
  feature: privacyFeatureIdSchema,
  enabled: z.boolean(),
  available: z.boolean(),
  mixed: z.boolean(),
  needsRestart: z.boolean(),
  overridden: z.boolean(),
  reason: z.string().max(300).nullable(),
})

const controlsSnapshotSchema = z.object({
  available: z.boolean(),
  liveReload: z.boolean(),
  reason: z.string().max(300).nullable(),
  features: z.array(featureStateSchema).length(5),
})

export type PrivacyFeatureState = z.infer<typeof featureStateSchema>
export type PrivacyControlsSnapshot = z.infer<typeof controlsSnapshotSchema>

export const privacyControlsApi = defineApi({
  id: 'privacy-controls',
  version: 1,
  owner: '@dshfiles/privacy-controls',
  methods: {
    read: method({
      input: z.void(),
      output: controlsSnapshotSchema,
      description: 'Read the effective feedback, upload, and session-log download controls for this Web profile.',
    }),
    setFeature: method({
      input: z.object({ feature: privacyFeatureIdSchema, enabled: z.boolean() }).strict(),
      output: controlsSnapshotSchema,
      description: 'Enable or disable one supported feedback, upload, or download feature for this Web profile.',
    }),
    setAll: method({
      input: z.object({ enabled: z.boolean() }).strict(),
      output: controlsSnapshotSchema,
      description: 'Enable or disable all feedback and upload features without changing session-log downloads.',
    }),
  },
})
