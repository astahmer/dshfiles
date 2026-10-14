export const privacyFeatures = [
  {
    id: 'answer-feedback-ui',
    defaultEnabled: false,
    rows: [{ patchId: 'message-feedback' }, { patchId: 'ui-message-feedback' }],
  },
  {
    id: 'session-feedback-capture',
    defaultEnabled: false,
    rows: [{ patchId: 'command-feedback' }],
  },
  {
    id: 'otel-session-upload',
    defaultEnabled: false,
    rows: [{ patchId: 'session-telemetry-otel' }],
  },
  {
    id: 'deepseek-session-log-upload',
    defaultEnabled: false,
    rows: [{ patchId: 'session-log-deepseek' }],
  },
  {
    id: 'session-log-download',
    defaultEnabled: true,
    rows: [{ patchId: 'session-log-download' }],
  },
] as const

export type PrivacyFeatureId = (typeof privacyFeatures)[number]['id']
export type MasterFeatureId = Extract<
  PrivacyFeatureId,
  'answer-feedback-ui' | 'session-feedback-capture' | 'otel-session-upload' | 'deepseek-session-log-upload'
>

export const masterFeatureIds = [
  'answer-feedback-ui',
  'session-feedback-capture',
  'otel-session-upload',
  'deepseek-session-log-upload',
] as const satisfies readonly MasterFeatureId[]
