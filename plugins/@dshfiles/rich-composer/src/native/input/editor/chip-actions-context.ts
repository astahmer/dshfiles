import { createContext } from 'react'
import type { NodeKey } from 'lexical'

export interface ChipActions {
  readonly remove: (key: NodeKey) => void
  readonly setComment: (input: { readonly key: NodeKey; readonly comment: string }) => void
}

export const ChipActionsContext = createContext<ChipActions | null>(null)
