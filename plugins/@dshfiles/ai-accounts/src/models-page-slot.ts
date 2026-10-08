/**
 * Settings › Models declares its footer seat at runtime. Its type package
 * (`@deepseek-ai/dsh-client-ui-settings-models`) is not a dependency of this
 * plugin, so the one seat used here is restated with the published shape.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.footer': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
  }
}

export {}
