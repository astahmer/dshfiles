/**
 * Phone stack motion (visual refresh T5.2, plan phone rules "Motion"): pushing a thread or a page over the list slides
 * it in from the right, Back slides it out, through a same-document View Transition. The direction is published as
 * `html[data-phone-stack-motion]` for the transition CSS in `@dshfiles/plugin-ui` styles (`::view-transition-*`);
 * without the API, with reduced motion, or while a transition is already running, the update simply happens.
 */
export type StackMotion = 'push' | 'pop'

const ATTRIBUTE = 'data-phone-stack-motion'

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { readonly finished: Promise<void> }
}

let running = false

/**
 * About two frames, measured with a timer: the frame and the list are other React roots, so their commit lands after
 * the update returns. Never `requestAnimationFrame` here: rendering (and with it rAF) is suppressed while a View
 * Transition's update callback is pending, so waiting for a frame would never resolve (WebKit has no timeout).
 */
const SETTLE_MS = 34
/** A transition that has not finished by then is abandoned, so a stuck one never blocks later moves. */
const ABANDON_MS = 1000

const settled = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, SETTLE_MS)
  })

export const StackMotionPolicy = {
  /**
   * Animate only on a touch screen (the phone rules; a narrow desktop window with a mouse switches instantly, so a
   * click right after a push never races the deferred update), where the API exists, motion is allowed and no
   * transition is in flight.
   */
  animates: (input: { readonly supported: boolean; readonly touch: boolean; readonly reducedMotion: boolean; readonly running: boolean }): boolean =>
    input.supported && input.touch && !input.reducedMotion && !input.running,
} as const

export const runStackMotion = (motion: StackMotion, update: () => void): void => {
  // oxlint-disable-next-line antislop/no-passthrough-variable -- the alias types the optional View Transitions API, checked below.
  const doc: ViewTransitionDocument = document
  const media = (query: string): boolean => typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const reducedMotion = media('(prefers-reduced-motion: reduce)')
  const touch = media('(pointer: coarse)')
  if (!StackMotionPolicy.animates({ supported: typeof doc.startViewTransition === 'function', touch, reducedMotion, running })) {
    update()
    return
  }
  const root = document.documentElement
  running = true
  root.setAttribute(ATTRIBUTE, motion)
  let finished = false
  const done = (): void => {
    if (finished) return
    finished = true
    running = false
    root.removeAttribute(ATTRIBUTE)
  }
  setTimeout(done, ABANDON_MS)
  try {
    const transition = doc.startViewTransition!(async () => {
      update()
      await settled()
    })
    transition.finished.then(done, done)
  } catch {
    done()
    update()
  }
}
