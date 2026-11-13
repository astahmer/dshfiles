import { isMobileDevice } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Whether selection actions should use touch placement. Some Android phones report `hover: hover` and a fine
 * pointer, so the media query alone misses them; the last pointer and the phone user agent cover those.
 * @param lastPointerType - `pointerType` of the latest pointerdown, or '' before any.
 * @returns true for a touch gesture, a coarse primary pointer or a recognized phone.
 */
export const isTouchInput = (lastPointerType: string): boolean =>
  lastPointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches || isMobileDevice()
