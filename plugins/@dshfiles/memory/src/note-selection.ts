import type { PanelNote } from './api.js'

export interface BatchForgetOutcome {
  readonly forgotten: readonly number[]
  readonly failed: readonly number[]
}

export class NoteSelectionModel {
  /** The valid notes in the order the panel renders them, so Shift ranges match the screen. */
  static orderedSelectableIds(input: { readonly notes: readonly PanelNote[]; readonly types: readonly PanelNote['type'][] }): number[] {
    return input.types.flatMap(type => input.notes.filter(note => note.type === type && note.status === 'valid').map(note => note.id))
  }

  static async forget(input: {
    readonly ids: readonly number[]
    readonly reason: string
    readonly forget: (input: { readonly id: number; readonly reason: string }) => Promise<void>
  }): Promise<BatchForgetOutcome> {
    const results = await Promise.allSettled(input.ids.map(id => input.forget({ id, reason: input.reason })))
    return {
      forgotten: input.ids.filter((_, index) => results[index]?.status === 'fulfilled'),
      failed: input.ids.filter((_, index) => results[index]?.status === 'rejected'),
    }
  }
}
