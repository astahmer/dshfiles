import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import type { MainSurfaceMode, MainSurfaceOwnerProps, MainSurfaceSeat } from './regions.js'
import type { createLayoutStore } from './native/client/stores.js'

/** Adapt the frame's real store; no second mode state lives in the seat. */
export function createMainSurfaceSeat(
  instance: ReturnType<ReturnType<typeof createLayoutStore>['create']>,
  subscribePanelRequests?: NonNullable<MainSurfaceSeat['subscribePanelRequests']>,
): MainSurfaceSeat {
  const mode = (): ReturnType<MainSurfaceSeat['mode']> => instance.getSnapshot().layoutInfo.mainSurfaceMode
  return {
    mode,
    subscribePanelRequests: listener => subscribePanelRequests?.(listener) ?? (() => undefined),
    setMode: next => instance.actions.setMainSurfaceMode(next),
    subscribe: listener => {
      let previous = mode()
      return instance.subscribe(() => {
        const next = mode()
        if (previous === next) return
        previous = next
        listener()
      })
    },
  }
}

/** Pure render-policy helpers; the store-backed seat factory stays a separate boundary. */
export class MainSurfaceRendering {
  /** Use the installed renderer's empty-seat fallback, never a mirrored registry. */
  static render(
    mode: MainSurfaceMode,
    renderSlot: PropsRenderSlots<'shell.main'>['renderSlot'],
    renderMain: MainSurfaceOwnerProps['renderMain'],
    native: ReactNode,
  ): ReactNode {
    return mode === 'workbench' ? renderSlot('shell.main', { renderMain }, { fallback: native }) : native
  }

  /** Narrow the frame-authorized renderer without exposing another slot domain. */
  static createRenderer(renderSlot: PropsRenderSlots<'main'>['renderSlot']): MainSurfaceOwnerProps['renderMain'] {
    return entryKey => (entryKey === 'dshfiles-workbench' ? null : renderSlot('main', {}, { entryKey }))
  }
}
