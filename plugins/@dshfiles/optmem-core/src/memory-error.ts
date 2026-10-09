export type MemoryErrorCode = 'invalid-address' | 'out-of-range' | 'scope-denied' | 'not-found' | 'closed'

export class MemoryError extends Error {
  readonly code: MemoryErrorCode

  constructor(code: MemoryErrorCode, message: string) {
    super(message)
    this.name = 'MemoryError'
    this.code = code
  }
}
