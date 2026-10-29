import { Command, defineClient } from '@dshfiles/dshx/client'
import { apply } from './client/index.js'
import { CommandSlashSource } from './command-slash-source.js'

export default defineClient({
  name: '@dshfiles/input-trigger',
  inject: ['sessions', 'locale', 'slots'],
  setup: (ctx, _decorate, metadata) => {
    apply(ctx)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    ctx.inject(['inputTriggers'], scope => {
      scope.effect(
        () => plugin.keyed(plugin.list(Command), commands => scope.inputTriggers.registerSource(CommandSlashSource.create(commands))),
        'input-trigger: / entries of dshx commands',
      )
    })
  },
})
