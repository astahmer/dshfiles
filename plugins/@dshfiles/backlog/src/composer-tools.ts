import type { ComposerToolProps } from '@dshfiles/dshx/client'
import { useRef, useState } from 'react'

/** The part of a composer tool's draft that names where it is; the box adds the draft itself. */
export type BacklogComposerTools = Pick<ComposerToolProps, 'surface' | 'scope' | 'scopeLabel'>

/** Every box writing about one item shares its scope, so what a tool keeps there shows in each of them. */
export class BacklogComposerScope {
  static readonly item = (input: { readonly id: number; readonly surface: string }): BacklogComposerTools => ({
    surface: input.surface,
    scope: `backlog:item:${input.id}`,
    scopeLabel: 'item',
  })

  /** A capture has no item yet, so its tools belong to the box the draft is kept under. */
  static readonly capture = (draftKey: string): BacklogComposerTools => ({
    surface: 'backlog.capture',
    scope: `backlog:capture:${draftKey}`,
    scopeLabel: 'draft',
  })
}

interface ComposerToolHold {
  readonly hold: () => () => void
  readonly held: () => boolean
}

/** Counts the tools working outside a draft; `onReleased` runs after the last one lets go. */
export const createComposerToolHold = (onReleased: () => void): ComposerToolHold => {
  let holds = 0
  return {
    hold: () => {
      holds += 1
      let active = true
      return () => {
        if (!active) return
        active = false
        holds -= 1
        if (holds === 0) onReleased()
      }
    },
    held: () => holds > 0,
  }
}

export const useComposerToolHold = (onReleased: () => void): ComposerToolHold => {
  const released = useRef(onReleased)
  released.current = onReleased
  return useState(() => createComposerToolHold(() => released.current()))[0]
}
