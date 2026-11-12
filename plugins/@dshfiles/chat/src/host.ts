/** Host registration for browser Chat preferences. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { ChatSettings, CollapseTiming, FoldedReplies, ImageGalleryScope, LinkOpening, PerformanceUsageMode, UnreadLanding } from './chat-settings.ts'
import z from '@deepseek-ai/schemastery'
import { defineHost } from '@dshfiles/dshx/host'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { CHAT_SETTINGS_NAMESPACE, IMAGE_GALLERY_SCOPE_FIELD, TRANSCRIPT_VIEW_FIELD, UNREAD_LANDING_FIELD } from './chat-settings.ts'
import { transcriptViewApi } from './transcript-view-api.ts'
import { savedTranscriptView, type TranscriptViewMode } from './transcript-view-modes.ts'

import { ChatSettingsFields } from './chat-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Completed turn transcript presentation. */
  transcriptView: Volatile<ChatSettings['transcriptView']>
  /** When completed work details return to their historical presentation. */
  collapseTiming: Volatile<CollapseTiming>
  /** Assistant replies kept visible while a completed Turn folds its process. */
  foldedReplies: Volatile<FoldedReplies>
  /** Performance and usage detail level. */
  performanceUsage: Volatile<PerformanceUsageMode>
  /** Default destination for Chat HTTP(S) links. */
  linkOpening: Volatile<LinkOpening>
  imageGalleryScope: Volatile<ImageGalleryScope>
  /** Where a thread with an unseen final answer opens. */
  unreadLanding: Volatile<UnreadLanding>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [TRANSCRIPT_VIEW_FIELD]: ChatSettingsFields[TRANSCRIPT_VIEW_FIELD].volatile(),
  collapseTiming: ChatSettingsFields.collapseTiming.volatile(),
  foldedReplies: ChatSettingsFields.foldedReplies.volatile(),
  performanceUsage: ChatSettingsFields['performanceUsage'].volatile(),
  linkOpening: ChatSettingsFields.linkOpening.volatile(),
  [IMAGE_GALLERY_SCOPE_FIELD]: ChatSettingsFields[IMAGE_GALLERY_SCOPE_FIELD].volatile(),
  [UNREAD_LANDING_FIELD]: ChatSettingsFields[UNREAD_LANDING_FIELD].volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}

/** dshfiles: the settings service, read at each call because it may load after Chat. */
const settingsOf = (ctx: Context) => {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('This Host serves no settings service, so the Chat view mode cannot be read or saved. Open Settings › General › View mode instead.')
  return settings
}

/** dshfiles: the one field of the saved `dshfiles-chat` section the view-mode tools read; other fields pass through. */
const savedSection = Schema.Struct({ [TRANSCRIPT_VIEW_FIELD]: Schema.optional(Schema.NullOr(Schema.String)) })

/** dshfiles: the saved Chat view mode and the namespace revision a write must name. */
export const readTranscriptView = (ctx: Context) => {
  const row = settingsOf(ctx).describe({ redactSecrets: true }).find(entry => entry.ns === CHAT_SETTINGS_NAMESPACE)
  const section = Option.getOrUndefined(Schema.decodeUnknownOption(savedSection)(row?.value))
  return { saved: savedTranscriptView(section?.[TRANSCRIPT_VIEW_FIELD]) ?? null, revision: row?.revision }
}

/**
 * dshfiles (visual refresh T2.5): the Settings row's view mode as agent tools, `transcript_view_get` and
 * `transcript_view_set`, on the same `dshfiles-chat` field. Writes name the revision they read, so a concurrent change
 * is refused rather than overwritten; `device-default` unsets the field, which reverses any saved choice.
 */
export const writeTranscriptView = async (ctx: Context, mode: TranscriptViewMode | 'device-default'): Promise<{ saved: TranscriptViewMode | null }> => {
  const { revision } = readTranscriptView(ctx)
  if (mode === 'device-default') {
    await settingsOf(ctx).mutate(CHAT_SETTINGS_NAMESPACE, [{ op: 'unset', path: [TRANSCRIPT_VIEW_FIELD] }], revision)
    return { saved: null }
  }
  await settingsOf(ctx).update(CHAT_SETTINGS_NAMESPACE, { [TRANSCRIPT_VIEW_FIELD]: mode }, revision)
  return { saved: mode }
}

const transcriptViewHost = transcriptViewApi.host({
  get: ({ ctx }) => ({ saved: readTranscriptView(ctx).saved }),
  set: ({ ctx, input }) => writeTranscriptView(ctx, input.mode),
})

/**
 * dshfiles: the native Host module, through dshx so it can also serve the view-mode API. `Config` is the same
 * schemastery object (it implements Standard Schema), so the `dshfiles-chat` namespace and its live projection to the
 * browser are unchanged; setup is the native `apply`.
 */
export default defineHost({
  Config,
  apis: [transcriptViewHost],
  setup: (ctx: Context) => { apply(ctx) },
})
