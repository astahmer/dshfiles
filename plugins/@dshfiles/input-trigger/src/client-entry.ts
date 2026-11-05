import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Command, defineClient } from '@dshfiles/dshx/client'
import { createElement } from 'react'
import { apply } from './client/index.js'
import { EntityPreviewOverlay } from './client/entity-preview-overlay.js'
import { CommandSlashSource } from './command-slash-source.js'
import { EntityKinds, EntityRegistryModel } from './entity-registry.js'

export default defineClient({
  name: '@dshfiles/input-trigger',
  inject: ['sessions', 'locale', 'slots'],
  setup: (ctx, decorate, metadata) => {
    apply(ctx)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    ctx.inject(['inputTriggers'], scope => {
      scope.effect(
        () => plugin.keyed(plugin.list(Command), commands => scope.inputTriggers.registerSource(CommandSlashSource.create(commands))),
        'input-trigger: / entries of dshx commands',
      )
      // Every `@` group a plugin provides through the entity registry registers here, in the registry's order.
      scope.effect(
        () =>
          plugin.keyed(plugin.list(EntityKinds), kinds => {
            const unregister = EntityRegistryModel.arrange(kinds).flatMap(kind =>
              kind.mentionSource === undefined ? [] : [scope.inputTriggers.registerSource(kind.mentionSource)],
            )
            return () => {
              for (const off of unregister) off()
            }
          }),
        'input-trigger: @ sources of the entity registry',
      )
    })
    // The one reference-preview card every entity kind renders into.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-entity-preview', order: 120 },
        decorate(() => createElement(EntityPreviewOverlay)),
      ),
    )
  },
})
