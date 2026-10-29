/** Host registration for browser Chat preferences. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { ChatSettings, CollapseTiming, ImageGalleryScope, LinkOpening, PerformanceUsageMode } from './chat-settings.ts'
import z from '@deepseek-ai/schemastery'
import { IMAGE_GALLERY_SCOPE_FIELD, TRANSCRIPT_VIEW_FIELD } from './chat-settings.ts'

import { ChatSettingsFields } from './chat-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Completed turn transcript presentation. */
  transcriptView: Volatile<ChatSettings['transcriptView']>
  /** When completed work details return to their historical presentation. */
  collapseTiming: Volatile<CollapseTiming>
  /** Performance and usage detail level. */
  performanceUsage: Volatile<PerformanceUsageMode>
  /** Default destination for Chat HTTP(S) links. */
  linkOpening: Volatile<LinkOpening>
  imageGalleryScope: Volatile<ImageGalleryScope>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [TRANSCRIPT_VIEW_FIELD]: ChatSettingsFields[TRANSCRIPT_VIEW_FIELD].volatile(),
  collapseTiming: ChatSettingsFields.collapseTiming.volatile(),
  performanceUsage: ChatSettingsFields['performanceUsage'].volatile(),
  linkOpening: ChatSettingsFields.linkOpening.volatile(),
  [IMAGE_GALLERY_SCOPE_FIELD]: ChatSettingsFields[IMAGE_GALLERY_SCOPE_FIELD].volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
