/**
 * Keyboard answering for the question card (unslop round three, item 22): on a fine pointer the card takes focus on
 * the option a bare Enter would send, digits 1–9 choose at card level, and focus goes back to the composer when the
 * card leaves. Kept out of the native component so it is testable without a DOM.
 */

/** An option as the card lists it: its label may carry the "(Recommended)" suffix. */
interface KeyedOption {
  readonly label: string
}

/** A key press the card sees, reduced to what decides a digit choice. */
interface KeyPress {
  readonly key: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
}

/**
 * The option that takes focus when a question is shown: the one already chosen, else the recommended one, else the
 * first.
 * @param options - the question's options in order.
 * @param selected - labels the draft already holds.
 * @param isRecommended - whether a label carries the recommendation (the card's `parseRecommendedLabel`).
 * @returns the index to focus, or undefined when the question has no options.
 */
const initialOption = (
  options: readonly KeyedOption[],
  selected: readonly string[],
  isRecommended: (label: string) => boolean,
): number | undefined => {
  if (options.length === 0) return undefined
  const chosen = options.findIndex(option => selected.includes(option.label))
  if (chosen >= 0) return chosen
  const recommended = options.findIndex(option => isRecommended(option.label))
  return recommended >= 0 ? recommended : 0
}

/**
 * The option a digit names: `1` is the first. Modified keys, IME composition and digits past the list choose nothing.
 * @param press - the key event.
 * @param optionCount - how many options the question shows.
 * @returns the option index, or undefined.
 */
const digitOption = (press: KeyPress, optionCount: number): number | undefined => {
  if (press.altKey || press.ctrlKey || press.metaKey || press.shiftKey || press.isComposing === true) return undefined
  if (!/^[1-9]$/.test(press.key)) return undefined
  const index = Number(press.key) - 1
  return index < optionCount ? index : undefined
}

/** Whether a key event comes from a place that types text, where a digit is a character and never a choice. */
const typesText = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type))
}

/**
 * Whether the card may take focus now: nothing else holds it (the page body), or it is already inside the card or the
 * composer seat the card replaced. A field the user chose elsewhere keeps it.
 * @param active - `document.activeElement`.
 * @param scope - the elements the card may take focus from.
 * @returns true when moving focus steals nothing.
 */
const mayTakeFocus = <T>(active: T | null, scope: { readonly body: T; readonly within: readonly ({ contains(other: T): boolean } | null)[] }): boolean =>
  active === null || active === scope.body || scope.within.some(element => element?.contains(active) === true)

/** Whether the primary pointer is precise: on touch, moving focus would open the keyboard or scroll the page. */
const finePointer = (): boolean => globalThis.matchMedia?.('(pointer: fine)').matches === true

/** The composer's editor in one conversation, once it is laid out. */
const COMPOSER_EDITOR = '[data-composer-card] [contenteditable="true"], [data-composer-card] textarea'

/**
 * Give focus back to the conversation's composer after the card left: the composer may come back a frame or two later,
 * so this looks for it for a few frames and stops at the first one, or when something else took focus meanwhile.
 * @param conversation - the conversation the card belonged to.
 * @param frames - how many animation frames to look for.
 */
const focusComposer = (conversation: Element, frames = 10): void => {
  const attempt = (left: number): void => {
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const editor = conversation.querySelector<HTMLElement>(COMPOSER_EDITOR)
    if (editor !== null && editor.getClientRects().length > 0) {
      editor.focus({ preventScroll: true })
      return
    }
    if (left > 0) requestAnimationFrame(() => { attempt(left - 1) })
  }
  requestAnimationFrame(() => { attempt(frames) })
}

export const QuestionKeys = { initialOption, digitOption, typesText, mayTakeFocus, finePointer, focusComposer, COMPOSER_EDITOR }
