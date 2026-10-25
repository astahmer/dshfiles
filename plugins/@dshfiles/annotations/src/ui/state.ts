import { useSyncExternalStore } from 'react'
import type { AnnotationTarget } from '../schema.js'

export type PickMode = 'element' | 'region'

export interface PickedTarget {
  readonly target: AnnotationTarget
  readonly point: { readonly x: number; readonly y: number }
  readonly mode: PickMode
}

export interface AnnotationsUiState {
  readonly sessionId: string | null
  readonly pickMode: boolean
  readonly mode: PickMode
  readonly picked: PickedTarget | null
}

const initialState: AnnotationsUiState = { sessionId: null, pickMode: false, mode: 'element', picked: null }

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
  beginPick: ({ sessionId, mode }: { readonly sessionId: string; readonly mode: PickMode }): void => {
    state = { ...state, sessionId, pickMode: true, mode, picked: null }
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
  clearPicked: (): void => {
    if (state.picked === null) return
    state = { ...state, picked: null }
    emit()
  },
  setSession: (sessionId: string | null): void => {
    if (state.sessionId === sessionId) return
    state = { ...state, sessionId, pickMode: false, picked: null }
    emit()
  },
}

export const useAnnotationsUi = (): AnnotationsUiState => useSyncExternalStore(subscribe, snapshot, snapshot)
