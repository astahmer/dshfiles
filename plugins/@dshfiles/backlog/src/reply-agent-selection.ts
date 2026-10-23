export type ReplyAgentOrder = 'preferred' | 'last-used'

export class ReplyAgentSelection {
  static choose<T>(input: { readonly order: ReplyAgentOrder; readonly preferred: T | null; readonly lastUsed: T | null }): T | null {
    return input.order === 'preferred' ? (input.preferred ?? input.lastUsed) : (input.lastUsed ?? input.preferred)
  }
}
