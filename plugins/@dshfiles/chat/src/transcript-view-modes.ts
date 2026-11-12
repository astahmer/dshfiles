/**
 * The Chat transcript view mode as a dependency-free contract: the settings namespace and field Chat stores it in, the
 * modes it accepts and the names the user sees. Chat's Settings row (browser) and its `chat-view` agent tools (Host)
 * both read it from here, so neither restates the other.
 */

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'dshfiles-chat'

/** Field carrying the work-details presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Work-details presentation modes Chat accepts, least to most detail. */
export const TRANSCRIPT_VIEW_MODES = ['compact', 'standard', 'detailed', 'verbose'] as const

/** Work-details presentation mode. */
export type TranscriptViewMode = (typeof TRANSCRIPT_VIEW_MODES)[number]

/**
 * The three modes offered as Summary / Normal / Verbose (visual refresh T2.5). `standard` stays accepted for saved
 * values and the desktop app's default, and is offered only while it is the current choice.
 */
export const OFFERED_TRANSCRIPT_VIEW_MODES = ['compact', 'detailed', 'verbose'] as const satisfies readonly TranscriptViewMode[]

/** The user-facing name of each mode. */
export const TRANSCRIPT_VIEW_MODE_NAMES = {
  compact: 'Summary',
  standard: 'Standard',
  detailed: 'Normal',
  verbose: 'Verbose',
} as const satisfies Readonly<Record<TranscriptViewMode, string>>

/** What each mode shows, for agent tools and descriptions. */
export const TRANSCRIPT_VIEW_MODE_DESCRIPTIONS = {
  compact: 'every turn folds its tool work under one "Worked for" row; failures and questions stay visible',
  standard: 'finished turns fold; live turns show their current step in grouped rows',
  detailed: 'finished turns fold under "Worked for"; tool calls show as rows while a turn runs',
  verbose: 'every tool call stays open as its own row',
} as const satisfies Readonly<Record<TranscriptViewMode, string>>

/** Saved values from older generations of this setting, read as `detailed`. */
export const LEGACY_TRANSCRIPT_VIEW_MODES = ['normal', 'expanded'] as const

/** Default without a saved choice: Summary on a touch phone, Normal elsewhere (the desktop app keeps `standard`). */
export const deviceDefaultTranscriptView = (input: { readonly desktopApp: boolean; readonly coarsePointer: boolean }): TranscriptViewMode =>
  input.desktopApp ? 'standard' : input.coarsePointer ? 'compact' : 'detailed'

/** The mode a saved string means (legacy values read as Normal), or undefined when nothing usable is saved. */
export const savedTranscriptView = (saved: string | null | undefined): TranscriptViewMode | undefined => {
  if (LEGACY_TRANSCRIPT_VIEW_MODES.some(legacy => legacy === saved)) return 'detailed'
  return TRANSCRIPT_VIEW_MODES.find(mode => mode === saved)
}
