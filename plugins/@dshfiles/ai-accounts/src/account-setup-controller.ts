export interface AccountSetupRequest {
  readonly id: number
  readonly operationId: string
  readonly signal: AbortSignal
  readonly accountId?: string
  readonly onCreated?: (accountId: string) => void
}

type SetupOptions = Pick<AccountSetupRequest, 'accountId' | 'onCreated'>

// getRandomValues also works on the existing HTTP LAN GUI, where crypto.randomUUID is unavailable.
export const setupOperationId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** One replaceable presentation intent. Closing A must never close a newer setup B. */
export const createAccountSetupController = (newOperationId: () => string = setupOperationId) => {
  let current: AccountSetupRequest | null = null
  let abort: AbortController | null = null
  let nextId = 0
  const listeners = new Set<() => void>()
  const publish = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: (): AccountSetupRequest | null => current,
    isCurrent: (id: number): boolean => current?.id === id && !current.signal.aborted,
    open: (input: SetupOptions = {}): void => {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot required: old abort callbacks must see the already-published new intent, not cancel its controller.
      const previous = abort
      abort = new AbortController()
      current = { ...input, id: ++nextId, operationId: newOperationId(), signal: abort.signal }
      previous?.abort()
      publish()
    },
    close: (expectedId?: number): void => {
      if (expectedId !== undefined && current?.id !== expectedId) return
      current = null
      abort?.abort()
      abort = null
      publish()
    },
  }
}

export type AccountSetupController = ReturnType<typeof createAccountSetupController>
