import { z } from 'zod'

/**
 * Cross-plugin entry point: any plugin opens Settings with
 * `window.dispatchEvent(new CustomEvent('dshfiles:open-settings', { detail, cancelable: true }))`. The shell calls
 * `preventDefault()` when it took the request, so `dispatchEvent` returning false means handled (the same contract as
 * `dshfiles:open-file` and `dshfiles:command-palette`).
 */
export const OPEN_SETTINGS_EVENT = 'dshfiles:open-settings'

export const openSettingsRequestSchema = z.object({
  /** A `settings.section` id (`general`, `models`, `plugins`, …). */
  section: z.string().min(1).max(200).optional(),
  /** A settings field: the namespace (Loader entry id) and the path inside it. */
  setting: z.object({ entryId: z.string().min(1).max(200), fieldPath: z.array(z.string().min(1).max(200)).max(16) }).optional(),
  /** A search entry id `section` publishes: the section opens scrolled to that control. */
  target: z.string().min(1).max(200).optional(),
  /** Search Settings for this text. */
  query: z.string().max(200).optional(),
  /** Force the dialog or the tab instead of the user's `openIn` preference. */
  surface: z.enum(['modal', 'tab']).optional(),
})

export type OpenSettingsRequest = z.infer<typeof openSettingsRequestSchema>
