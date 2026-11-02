import * as Schema from 'effect/Schema'

/**
 * Cross-plugin entry point: any plugin opens Settings with
 * `window.dispatchEvent(new CustomEvent('dshfiles:open-settings', { detail, cancelable: true }))`. The shell calls
 * `preventDefault()` when it took the request, so `dispatchEvent` returning false means handled (the same contract as
 * `dshfiles:open-file`).
 */
export const OPEN_SETTINGS_EVENT = 'dshfiles:open-settings'

export const openSettingsRequestSchema = Schema.Struct({
  /** A `settings.section` id (`general`, `models`, `plugins`, …). */
  section: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  /** A settings field: the namespace (Loader entry id) and the path inside it. */
  setting: Schema.optionalKey(
    Schema.Struct({
      entryId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      fieldPath: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).check(Schema.isMaxLength(16)),
    }),
  ),
  /** A search entry id `section` publishes: the section opens scrolled to that control. */
  target: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  /** Search Settings for this text. */
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  /** Force the dialog or the tab instead of the user's `openIn` preference. */
  surface: Schema.optionalKey(Schema.Literals(['modal', 'tab'])),
})

export type OpenSettingsRequest = typeof openSettingsRequestSchema.Type
