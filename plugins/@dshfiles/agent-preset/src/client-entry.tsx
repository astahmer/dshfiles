import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { defineClient } from '@dshfiles/dshx/client'
import { ComposerMoreItems } from '@dshfiles/rich-composer/composer-more'
import { AgentPresetMenuRequests } from './native/menu-requests.ts'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/agent-preset',
  inject,
  setup(ctx, _decorate, metadata) {
    apply(ctx)
    // The composer shows the agent-mode chip only when a new thread will start with a non-default preset, or when the
    // user asks for it (rich-composer's showAgentPresetPicker, b:4v6p). These rows keep the choice one step away:
    // both open the new-thread chip's menu, which shows the chip while it is open.
    metadata?.plugin?.add(PaletteActions, {
      id: '@dshfiles/agent-preset/choose',
      group: 'command',
      label: 'Agent mode: choose for the new thread…',
      aliases: ['agent mode', 'agent preset', 'preset', 'standard mode', 'coding tools', 'creator'],
      isAvailable: () => AgentPresetMenuRequests.available(),
      // After the palette closes, so its focus return does not close the menu at once.
      run: () => {
        window.setTimeout(() => AgentPresetMenuRequests.open(), 0)
      },
    })
    metadata?.plugin?.add(ComposerMoreItems, {
      id: '@dshfiles/agent-preset.choose',
      group: 'mode',
      order: 50,
      label: 'Agent mode…',
      available: () => AgentPresetMenuRequests.available(),
      select: () => {
        window.setTimeout(() => AgentPresetMenuRequests.open(), 0)
      },
    })
  },
})
