/**
 * `settings.plugins.tab` is declared at runtime by the Host's Plugins settings
 * section; its type ships in `@deepseek-ai/dsh-client-ui-settings`, which this
 * package does not install, so the same declaration is restated here.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugins.tab': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
  }
}

export {}
