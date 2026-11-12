import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Schema } from 'effect'
import type { ZenSeat } from './regions.ts'

const zenSchema = Schema.Struct({ on: Schema.Boolean })

/**
 * Zen mode (plans/onboarding/calm-onboarding.md Z1): the window shows the thread and its composer only. Browser-local
 * presentation, like the panel widths: it never writes another owner's settings (`showMainTabs`, `hiddenStatusItems`,
 * the sidebar width), so leaving it shows exactly the layout that was there before.
 */
export class ZenMode {
  static readonly key = 'dshfiles.frame-layout.zen.v1'
  /** Set on `<html>` while zen is on; shell owners that draw their own chrome (Workbench's tab rows) hide it on this. */
  static readonly attribute = 'data-dshfiles-zen'
  /** The chord that enters and leaves zen (calm-onboarding decision 3; free in `@dshfiles/shortcuts` and the Host catalog). */
  static readonly keys: readonly string[] = ['Mod+Shift+.']

  /** The seat behind `ctx.zen`; missing, malformed or blocked storage reads as off. */
  static readonly create = (): ZenSeat => {
    const stored = createStoredValue({ key: ZenMode.key, schema: zenSchema, fallback: { on: false } })
    return {
      on: () => stored.get().on,
      set: on => {
        if (stored.get().on !== on) stored.set({ on })
      },
      subscribe: listener => stored.subscribe(listener),
    }
  }

  /** Mirror the seat onto the root attribute until disposed. */
  static readonly reflect = (seat: ZenSeat, root: HTMLElement): (() => void) => {
    const sync = (): void => {
      if (seat.on()) root.setAttribute(ZenMode.attribute, 'on')
      else root.removeAttribute(ZenMode.attribute)
    }
    sync()
    const unsubscribe = seat.subscribe(sync)
    return () => {
      unsubscribe()
      root.removeAttribute(ZenMode.attribute)
    }
  }
}
