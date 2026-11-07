import { useSyncExternalStore } from 'react'
import type { AnnotationTarget } from '../schema.js'

export type PickMode = 'element' | 'region'

export interface PickedTarget {
  readonly target: AnnotationTarget
  readonly point: { readonly x: number; readonly y: number }
  readonly mode: PickMode
}

/** One pick at a time, whichever composer started it; `scope` says where the note is stored. */
export interface AnnotationsUiState {
  readonly scope: string | null
  /** The action instance running the pick. Several composers can share a scope, and only this one holds its draft open. */
  readonly owner: string | null
  readonly pickMode: boolean
  readonly mode: PickMode
  readonly picked: PickedTarget | null
}

interface PickOrigin {
  readonly scope: string
  readonly owner: string
}

const initialState: AnnotationsUiState = { scope: null, owner: null, pickMode: false, mode: 'element', picked: null }

let state: AnnotationsUiState = initialState
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = (): AnnotationsUiState => state

export const annotationsUi = {
  snapshot,
  beginPick: ({ scope, owner, mode }: PickOrigin & { readonly mode: PickMode }): void => {
    state = { scope, owner, pickMode: true, mode, picked: null }
    emit()
  },
  cancelPick: (): void => {
    if (!state.pickMode) return
    state = { ...state, pickMode: false }
    emit()
  },
  picked: (picked: PickedTarget): void => {
    state = { ...state, pickMode: false, picked }
    emit()
  },
  /** A pick that finished elsewhere, in the picker browser, with no `beginPick` in this page. */
  pickedFrom: ({ scope, owner, picked }: PickOrigin & { readonly picked: PickedTarget }): void => {
    state = { ...state, scope, owner, pickMode: false, picked }
    emit()
  },
  clearPicked: (): void => {
    if (state.picked === null) return
    state = { ...state, picked: null }
    emit()
  },
  /** Drop a pick when the action running it leaves; a pick another composer started is not this one's to end. */
  release: (owner: string): void => {
    if (state.owner !== owner) return
    state = initialState
    emit()
  },
}

export const useAnnotationsUi = (): AnnotationsUiState => useSyncExternalStore(subscribe, snapshot, snapshot)
