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

/** Each action keeps its own composer draft writer; the overlay looks it up by owner so it never calls a stale one. */
const draftWriters = new Map<string, (text: string) => boolean>()

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
  registerDraftWriter: ({ owner, insertText }: { readonly owner: string; readonly insertText: (text: string) => boolean }): void => {
    draftWriters.set(owner, insertText)
  },
  /** Insert through the owning composer's latest writer; false when it is gone or refuses the text. */
  insertIntoDraft: ({ owner, text }: { readonly owner: string; readonly text: string }): boolean => draftWriters.get(owner)?.(text) ?? false,
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
    draftWriters.delete(owner)
    if (state.owner !== owner) return
    state = initialState
    emit()
  },
}

export const useAnnotationsUi = (): AnnotationsUiState => useSyncExternalStore(subscribe, snapshot, snapshot)
