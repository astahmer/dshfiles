/**
 * The native primitives package cannot load under Node (its brand-icon and ANSI dependencies are not installed in this
 * workspace), so tests replace its settings-form model with one that reads the bound scope and publishes on change.
 * The page's credential reads, which this fork changes, do not depend on the form model.
 */
interface Scope {
  readonly getSnapshot: () => { readonly value: Record<string, string> | undefined }
  readonly subscribe: (listener: () => void) => () => void
}

export class SettingsFormModel {
  constructor(private readonly scope: Scope) {}
  field(name: string) {
    return { text: this.scope.getSnapshot().value?.[name] ?? '' }
  }
  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
  }
  bind() {
    return { subscribe: (listener: () => void) => this.scope.subscribe(listener) }
  }
  actions() {
    return { edit: () => undefined, resetField: () => undefined, discard: () => undefined }
  }
  async save(): Promise<void> {}
  dispose(): void {}
}

export const settingsTextField = (name: string) => ({ name })
export const settingsNumberField = (name: string) => ({ name })
