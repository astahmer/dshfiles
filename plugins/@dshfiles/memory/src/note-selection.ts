export interface BatchForgetOutcome {
  readonly forgotten: readonly number[]
  readonly failed: readonly number[]
}

export class NoteSelectionModel {
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
