import { isMobileDevice } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Whether the draft is typed on a touch keyboard, whose return key has no Shift companion. Some Android phones
 * (Redmi Chrome) report a hover-capable pointer, so the media query alone misses them. A leaf module: the
 * contenteditable host (and the `rich-text-editor` dshx module built on it) must not import the composer view binding,
 * whose keymap reaches the fork's slot contract and stores.
 * @returns true on a recognized phone or tablet, or a touch-only pointer.
 */
export function hasTouchKeyboard(): boolean {
  return isMobileDevice() || (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches)
}
