/** Chat display preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import { TRANSCRIPT_VIEW_FIELD, TRANSCRIPT_VIEW_MODES, type TranscriptViewMode } from './transcript-view-modes.ts'

// dshfiles: the namespace, field and modes live in the dependency-free transcript-view-modes module, which Chat's
// view-mode agent tools (host.ts) import too.
export { CHAT_SETTINGS_NAMESPACE, TRANSCRIPT_VIEW_FIELD, TRANSCRIPT_VIEW_MODES, type TranscriptViewMode } from './transcript-view-modes.ts'

/** Field carrying the independent work-details collapse timing. */
export const COLLAPSE_TIMING_FIELD = 'collapseTiming'

/** Field selecting which related images appear in a Chat preview gallery. */
export const IMAGE_GALLERY_SCOPE_FIELD = 'imageGalleryScope'

/** Images a Chat preview can browse together. */
export const IMAGE_GALLERY_SCOPES = ['turn', 'thread'] as const

/** Gallery scope preference. */
export type ImageGalleryScope = typeof IMAGE_GALLERY_SCOPES[number]

/** Keep unrelated images out of a preview unless the user opts into thread scope. */
export const DEFAULT_IMAGE_GALLERY_SCOPE: ImageGalleryScope = 'turn'

/** Field selecting where opening a thread with an unseen final answer lands. */
export const UNREAD_LANDING_FIELD = 'unreadLanding'

/** Where an unseen final answer opens: at the answer's start, or at the transcript's end. */
export const UNREAD_LANDINGS = ['final-answer', 'bottom'] as const

/** Unread landing preference. */
export type UnreadLanding = typeof UNREAD_LANDINGS[number]

/** Land at the start of an unseen answer instead of below its tool tail. */
export const DEFAULT_UNREAD_LANDING: UnreadLanding = 'final-answer'

/** Available points when a completed Turn returns to its historical presentation. */
export const COLLAPSE_TIMINGS = ['completion', 'next-input'] as const

/** When a completed Turn returns to its historical presentation. */
export type CollapseTiming = typeof COLLAPSE_TIMINGS[number]

/** Preserve completion-time folding when no timing preference is saved. */
export const DEFAULT_COLLAPSE_TIMING: CollapseTiming = 'completion'

/**
 * Saved value from the two-mode generation of this setting. Read as `detailed`;
 * never offered as a choice and never written back.
 */
export const LEGACY_TRANSCRIPT_VIEW_MODE = 'normal'

/** Saved `expanded` values read as `detailed`, without being offered or written back. */
export const LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = 'expanded'

/** Every value the durable field accepts: current modes plus legacy saved values. */
const TRANSCRIPT_VIEW_SETTING_VALUES = [
  ...TRANSCRIPT_VIEW_MODES, LEGACY_TRANSCRIPT_VIEW_MODE, LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE,
] as const

/** Default work details for non-Desktop Web clients. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'detailed'

/** Performance and usage detail levels accepted by user settings. */
export const PERFORMANCE_USAGE_MODES = ['compact', 'detailed'] as const

/** Performance and usage presentation. */
export type PerformanceUsageMode = typeof PERFORMANCE_USAGE_MODES[number]

/** Preserve detailed accounting for users without an explicit preference. */
export const DEFAULT_PERFORMANCE_USAGE: PerformanceUsageMode = 'detailed'

/** Destinations for ordinary clicks on Chat HTTP(S) links. */
export type LinkOpening = 'sidebar' | 'new-tab'

/** Preserve the built-in browser for users without an explicit preference. */
export const DEFAULT_LINK_OPENING: LinkOpening = 'sidebar'

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Work-details preference; absence uses the client default, and legacy saved values remain accepted. */
  transcriptView?: TranscriptViewMode | typeof LEGACY_TRANSCRIPT_VIEW_MODE | typeof LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE | null
  /** Independent collapse timing; absence preserves completion-time folding. */
  collapseTiming?: CollapseTiming
  /** Detail level for composer statistics and completed-Turn usage. */
  performanceUsage: PerformanceUsageMode
  /** Default destination for Chat HTTP(S) links. */
  linkOpening: LinkOpening
  /** Which loaded conversation images an image preview can browse. */
  imageGalleryScope?: ImageGalleryScope
  /** Where a thread with an unseen final answer opens. */
  unreadLanding?: UnreadLanding
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsFields = {
  [COLLAPSE_TIMING_FIELD]: z.union([...COLLAPSE_TIMINGS]).default(DEFAULT_COLLAPSE_TIMING),
  [IMAGE_GALLERY_SCOPE_FIELD]: z.union([...IMAGE_GALLERY_SCOPES]).default(DEFAULT_IMAGE_GALLERY_SCOPE),
  [UNREAD_LANDING_FIELD]: z.union([...UNREAD_LANDINGS]).default(DEFAULT_UNREAD_LANDING),
  linkOpening: z.union(['sidebar', 'new-tab']).default(DEFAULT_LINK_OPENING),
  performanceUsage: z.union([...PERFORMANCE_USAGE_MODES]).default(DEFAULT_PERFORMANCE_USAGE),
  // Missing and unrecognized modes defer to the client's default.
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_SETTING_VALUES]).loose(),
}

/** Schema for shared configuration values. */
export const ChatSettingsSchema = z.object(ChatSettingsFields)
