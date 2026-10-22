import { formatSecretReference, type SecretReference } from '@dshfiles/credential-port'

type Field = HTMLInputElement | HTMLTextAreaElement

const textInputTypes = new Set(['', 'text', 'search'])

/**
 * The `data-secret-input="reference"` contract: a text field carrying it stores `secret:ALIAS[@env]` instead of a
 * value, so the Secret Catalog may offer its picker on it. The attribute is plain HTML, so a plugin marks its own
 * fields without importing the Catalog or the picker.
 */
export class SecretInputBinding {
  static readonly attribute = 'data-secret-input'
  static readonly reference = 'reference'
  static readonly selector = `[${SecretInputBinding.attribute}="${SecretInputBinding.reference}"]`

  /** Attributes to spread on an owned input, e.g. `<Input {...SecretInputBinding.attributes} />`. */
  static readonly attributes = { 'data-secret-input': 'reference' } as const

  /** A field the picker may write into: text-like, enabled and writable. */
  static accepts(element: Element): element is Field {
    if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
    if (!(element instanceof HTMLInputElement)) return false
    return !element.disabled && !element.readOnly && textInputTypes.has(element.type)
  }

  static isBacklogJevSetting(input: { readonly namespace: string | null; readonly path: string | null }): boolean {
    return input.namespace === 'dshfiles-backlog' && input.path === 'jevSecret'
  }

  /**
   * Writes text the way typing does: through the prototype's own value setter, then an `input` event, so a controlled
   * field's `onChange` fires. Assigning `element.value` directly updates the DOM but leaves that state stale, and the
   * next render reverts it.
   */
  static writeValue(element: Field, text: string): void {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
    if (descriptor?.set === undefined) element.value = text
    else descriptor.set.call(element, text)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }

  /** The text a pick stores, leaving out the default environment. */
  static referenceText(reference: SecretReference): string {
    return formatSecretReference(reference)
  }
}
