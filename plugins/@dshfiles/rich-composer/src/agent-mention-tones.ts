/**
 * Agent mention colours for the draft, published as the `@dshfiles/rich-composer/agent-mention-tones` dshx module. The
 * composer owns the chip; an agent registry (agents) adds a source that answers each agent's chosen identity slot. The
 * composer reads the first source and keeps the hashed slot for every agent it does not name, so it renders the same
 * without a provider. Imports no React and no provider: a plugin that colours mentions depends on rich-composer, never
 * the reverse (docs/plugin-boundaries.md).
 */
import { defineRegistry } from '@dshfiles/dshx/client'

export interface AgentMentionToneSource {
  /** Unique across plugins: the providing package plus a noun (`@dshfiles/agents.tones`). */
  readonly id: string
  /** Each agent's chosen slot by handle; agents without one are left out. Null when the registry could not be read. */
  readonly load: () => Promise<ReadonlyMap<string, number> | null>
}

export const AgentMentionTones = defineRegistry<AgentMentionToneSource>('@dshfiles/rich-composer.agent-mention-tones')
