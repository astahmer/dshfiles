import { defineClient } from '@dshfiles/dshx/client'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { composerControlsSettings } from './composer-controls-settings.ts'
import { apply, inject } from './native/index.js'

type ComposerControls = SettingsValue<typeof composerControlsSettings.schema>

const HiddenPermissionSelector = (): null => null

export default defineClient({
  name: '@dshfiles/rich-composer',
  inject,
  setup(ctx) {
    apply(ctx)

    // The permission seat is a single slot: a lower-priority empty occupant shadows the native selector, and
    // disposing it hands the seat back, so the toggle applies live without touching the vendored InputBar.
    const controls = ctx.configForms.get<ComposerControls>(composerControlsSettings.namespace)
    let disposeShadow: (() => void) | undefined
    const sync = (): void => {
      const hide = controls.getSnapshot().value?.hidePermissionSelector === true
      if (hide && disposeShadow === undefined) {
        disposeShadow = ctx.slots.register({ name: 'conversation.input.permission', priority: -1 }, HiddenPermissionSelector)
        return
      }
      if (!hide && disposeShadow !== undefined) {
        disposeShadow()
        disposeShadow = undefined
      }
    }
    const unsubscribe = controls.subscribe(sync)
    sync()
    ctx.effect(() => () => {
      unsubscribe()
      disposeShadow?.()
    })
  },
})
