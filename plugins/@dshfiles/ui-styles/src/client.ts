import { defineClient } from '@dshfiles/dshx/client'
import { AppearanceModel, type AppearanceSettings } from '@dshfiles/plugin-ui/theme/appearance'
import './client.css'
import { RuntimeTheme, RUNTIME_STYLE_ID } from './runtime-theme.js'
import { UI_STYLES_SETTINGS_NAMESPACE } from './settings-namespace.js'

export default defineClient({
  name: '@dshfiles/ui-styles',
  inject: ['configForms'],
  setup(ctx) {
    // Before the settings mirror answers: the last custom theme, so a reload does not flash the default.
    RuntimeTheme.applyThemeCss<HTMLElement>(document, RuntimeTheme.readCachedThemeCss())
    const form = ctx.configForms.get<Partial<AppearanceSettings>>(UI_STYLES_SETTINGS_NAMESPACE)
    const sync = (): void => {
      const snapshot = form.getSnapshot()
      if (snapshot.status === 'loading') return
      // `unavailable` is a Host that predates the Appearance settings (or has none): the static default applies.
      const css = snapshot.status === 'ready' ? AppearanceModel.runtimeThemeCss(snapshot.value) : ''
      RuntimeTheme.applyThemeCss<HTMLElement>(document, css)
      RuntimeTheme.writeCachedThemeCss(css)
    }
    ctx.effect(() => {
      sync()
      void ctx.configForms.describe().ensure()
      const unsubscribe = form.subscribe(sync)
      return () => {
        unsubscribe()
        document.getElementById(RUNTIME_STYLE_ID)?.remove()
      }
    }, 'dshfiles-ui-styles: apply the Appearance theme')
  },
})
