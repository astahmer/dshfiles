import { Effect } from 'effect'

export const later = (run: () => void) => {
  setTimeout(run, 10)
  globalThis.setInterval(run, 10)
  return Effect.void
}
