/** The composer actions that submit a draft; a first send of a New thread must be routed before they run. */
const SUBMITTING_MODES = new Set(['send', 'queue', 'steer'])

/**
 * Whether a click landed on the composer's submit button. `@dshfiles/rich-composer` names the button's action in
 * `data-send-mode`: only send, queue and steer submit a draft (stop, sending and continue never do). Its CSS-module
 * classes are hashed after the name (`_primary_fij92_599`), so no class test can find it. The stock
 * `@deepseek-ai/dsh-client-ui-conversation` composer, which this plugin also supports, has no such attribute and
 * builds its class with the name last (`uV2eYG_primary`): match that one by class.
 */
export const isSendButton = (target: EventTarget | null): boolean => {
  const button = target instanceof Element ? target.closest('button') : null
  if (button === null) return false
  const mode = button.getAttribute('data-send-mode')
  if (mode !== null) return SUBMITTING_MODES.has(mode)
  return /(?:^|\s)\S*_primary(?:\s|$)/u.test(button.className)
}
