/**
 * What another plugin may show under a tool card in the transcript, inside the frame this plugin already puts around
 * every dispatched call. Contributors depend on tool-meta, never the reverse (docs/plugin-boundaries.md): without one
 * the frame holds only the timing line. Published as the `@dshfiles/tool-meta/tool-call-sections` dshx module; importing
 * it loads none of the frame.
 */
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface ToolCallSectionProps {
  readonly owner: ToolCallOwnerProps
  /** The thread whose transcript holds this call. */
  readonly sessionId: string
}

export interface ToolCallSection {
  /** Stable id of the contribution. */
  readonly id: string
  /** Lower first; ties keep registration order. */
  readonly order?: number
  /**
   * Rendered for every call, whichever view owns its card, so return null fast for a call it has nothing to say about.
   * Subscribe inside this component: the transcript above it must not re-render for live data.
   */
  readonly Section: ComponentType<ToolCallSectionProps>
}

export const ToolCallSections = defineRegistry<ToolCallSection>('@dshfiles/tool-meta.tool-call-section')
