/**
 * The sidebar shell owns the restart dialog, its guards and the Host polls; the status strip item renders in another
 * tree. The shell publishes what the item shows here, and the item asks the shell to run a restart verb.
 */
export interface RestartNotice {
  /** Plugins whose Host code or package files changed on disk since the Host started. */
  readonly hostPlugins: readonly string[]
  /** The launcher can restart DSH; otherwise the item tells the user to restart it themselves. */
  readonly available: boolean
  /** Set while a "restart when idle" waits for running turns. */
  readonly waitingLabel: string | null
  /**
   * The rail's DSH actions show Restart (b:kgcc), which carries the same state and verbs, so the status strip draws no
   * second restart control. False while `showRailActions` is off or no supervisor can restart DSH.
   */
  readonly onRail: boolean
}

export type RestartRequest = 'restart' | 'restart-when-idle' | 'turn-off-auto-restart'

const EMPTY_NOTICE: RestartNotice = { hostPlugins: [], available: false, waitingLabel: null, onRail: false }

let current: RestartNotice = EMPTY_NOTICE
const listeners = new Set<() => void>()
const handlers = new Set<(request: RestartRequest) => void>()

const sameNotice = (left: RestartNotice, right: RestartNotice): boolean =>
  left.available === right.available &&
  left.onRail === right.onRail &&
  left.waitingLabel === right.waitingLabel &&
  left.hostPlugins.length === right.hostPlugins.length &&
  left.hostPlugins.every((plugin, index) => plugin === right.hostPlugins[index])

const publish = (next: RestartNotice): void => {
  if (sameNotice(current, next)) return
  current = next
  for (const listener of [...listeners]) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const onRequest = (handler: (request: RestartRequest) => void): (() => void) => {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

const request = (next: RestartRequest): void => {
  for (const handler of [...handlers]) handler(next)
}

/** Pending packages from every source, each once, sorted for a stable list. */
const combine = (lists: readonly (readonly string[])[]): readonly string[] => [...new Set(lists.flat())].sort((left, right) => left.localeCompare(right))

export class RestartBridge {
  static readonly empty = EMPTY_NOTICE
  static readonly publish = publish
  static readonly subscribe = subscribe
  static readonly read = (): RestartNotice => current
  static readonly onRequest = onRequest
  static readonly request = request
  static readonly combine = combine
}
