import type { WorkspaceComposer } from './workspace-submit.js'
import type { ToggleRequest } from './workspace-toggle-machine.js'

/** A thread workspace and the blank composer waiting in it, prepared before the first send asks for them. */
export type WarmComposer = WorkspaceComposer

export interface WarmPorts<Composer extends WarmComposer = WarmComposer> {
  /** Where this New thread would move on its first send; null keeps it where it is. */
  readonly destination: (signal: AbortSignal) => Promise<ToggleRequest | null>
  readonly isolate: (request: ToggleRequest, signal: AbortSignal) => Promise<{ readonly workspaceId: string }>
  readonly composerIn: (workspaceId: string, signal: AbortSignal) => Promise<Composer>
  /** Keep a provisioned but unused thread workspace for the next New thread instead of stranding it. */
  readonly keepSpare: (input: { readonly workspaceId: string; readonly name: string; readonly request: ToggleRequest }) => void
}

export interface WarmInput {
  readonly sessionId: string
  /** The workspace the New thread is sending from; a move out of it invalidates this warm. */
  readonly sourceWorkspaceId: string
  /** The name the destination would carry; shown while the send waits. */
  readonly name: string
}

/** What a first send takes from a warm instead of provisioning and connecting again. */
export interface PreparedWarm<Composer extends WarmComposer = WarmComposer> {
  readonly destination: (signal: AbortSignal) => Promise<ToggleRequest | null>
  readonly target: (signal: AbortSignal) => Promise<Composer>
}

interface WarmRecord<Composer extends WarmComposer> extends WarmInput {
  readonly ports: WarmPorts<Composer>
  readonly controller: AbortController
  destinationTask: Promise<ToggleRequest | null>
  composerTask: Promise<Composer | undefined>
  cancelTimer: () => void
  settled: 'pending' | 'ready' | 'kept' | 'failed'
  resolved: ToggleRequest | null
  provisioned: { readonly workspaceId: string; readonly name: string } | null
}

export interface WarmScheduler {
  readonly after: (milliseconds: number, task: () => void) => () => void
}

const systemScheduler: WarmScheduler = {
  after: (milliseconds, task) => {
    const timer = setTimeout(task, milliseconds)
    return () => clearTimeout(timer)
  },
}

/** A warm destination stops being useful once its blank Session's retention has expired under it. */
const WARM_EXPIRY_MS = 45_000

/** The decisions around preparing a New thread's destination, without touching the Host or the DOM. */
export class ThreadPreparation {
  /** A warm expires before the blank Session's retention does, so a send never takes a composer that is already gone. */
  static readonly expiryMs = WARM_EXPIRY_MS

  /** Whether the composer holds anything worth preparing a destination for. */
  static readonly holdsContent = (state: { readonly draft: string; readonly attachmentIds: readonly string[] }): boolean =>
    state.draft.trim() !== '' || state.attachmentIds.length > 0

  /**
   * Whether a New thread should start preparing its destination now. A draft is the signal: the user is writing a
   * prompt they are about to send, and writing it takes longer than the jj claim and Session the send would otherwise
   * wait for. A stray click into an empty composer claims nothing.
   */
  static readonly shouldPrepare = (input: {
    readonly blank: boolean
    readonly sending: boolean
    readonly content: boolean
    readonly isolating: boolean
  }): boolean => input.blank && !input.sending && input.isolating && input.content

  /**
   * Whether the main view still shows the New thread a first send left: its own blank Session, no main panel over it
   * (the jj panel, Settings, … are the other tabs) and its screen actually visible (a hidden main outlet is behind the
   * Start page). A user who went elsewhere means it, so the created thread must not take the view back.
   */
  static readonly waitsOnNewThread = (input: {
    readonly sourceSessionId: string
    readonly mainViewSessionId: string | undefined
    readonly activePanelId: string | null
    readonly screenVisible: boolean
  }): boolean => input.mainViewSessionId === input.sourceSessionId && input.activePanelId === null && input.screenVisible
}

/**
 * One warm destination per New thread, started while the user writes and taken by the first send. A warm keeps its own
 * abort signal; discarding it stops the work and, when a thread workspace was already provisioned, leaves that
 * workspace as this project's spare so the next New thread reuses it instead of provisioning another.
 */
export class ThreadWarmup<Composer extends WarmComposer = WarmComposer> {
  private readonly records = new Map<string, WarmRecord<Composer>>()

  constructor(
    private readonly options: {
      readonly expiryMs?: number
      readonly scheduler?: WarmScheduler
    } = {},
  ) {}

  /** Start (or keep) the destination of that New thread; a changed source workspace or name restarts it. */
  prepare(input: WarmInput, ports: WarmPorts<Composer>): void {
    const existing = this.records.get(input.sessionId)
    if (existing?.name === input.name && existing.sourceWorkspaceId === input.sourceWorkspaceId) return
    if (existing !== undefined) this.abandon(input.sessionId)
    const controller = new AbortController()
    const record: WarmRecord<Composer> = {
      ...input,
      ports,
      controller,
      destinationTask: Promise.resolve(null),
      composerTask: Promise.resolve(undefined),
      cancelTimer: () => {},
      settled: 'pending',
      resolved: null,
      provisioned: null,
    }
    record.destinationTask = Promise.resolve()
      .then(() => ports.destination(controller.signal))
      .catch(cause => {
        this.fail(input.sessionId, record)
        throw cause
      })
    record.composerTask = record.destinationTask
      .then(async request => {
        controller.signal.throwIfAborted()
        if (request === null || !request.isolate) {
          record.settled = 'kept'
          return undefined
        }
        record.resolved = request
        const landed = await ports.isolate(request, controller.signal)
        record.provisioned = { workspaceId: landed.workspaceId, name: input.name }
        const composer = await ports.composerIn(landed.workspaceId, controller.signal)
        controller.signal.throwIfAborted()
        record.settled = 'ready'
        return composer
      })
      .catch(cause => {
        this.fail(input.sessionId, record)
        throw cause
      })
    // Nothing awaits a warm: whoever sends first receives the rejection, and a later prepare retries from scratch.
    record.destinationTask.catch(() => undefined)
    record.composerTask.catch(() => undefined)
    record.cancelTimer = (this.options.scheduler ?? systemScheduler).after(this.options.expiryMs ?? WARM_EXPIRY_MS, () => this.abandon(input.sessionId))
    this.records.set(input.sessionId, record)
  }

  /** The warm a first send of that New thread takes, when it is still the one prepared for it. */
  for(input: WarmInput): PreparedWarm<Composer> | undefined {
    const record = this.records.get(input.sessionId)
    if (record === undefined || record.settled === 'failed') return undefined
    if (record.name !== input.name || record.sourceWorkspaceId !== input.sourceWorkspaceId) return undefined
    return {
      destination: async () => record.destinationTask,
      target: async () => {
        const composer = await record.composerTask
        if (composer === undefined) throw new Error('The prepared destination keeps the thread where it is.')
        return composer
      },
    }
  }

  /** The send took the destination: stop owning it, and never keep its workspace as a spare. */
  consume(sessionId: string): void {
    this.forget(sessionId, this.records.get(sessionId))
  }

  /** The thread was abandoned or re-targeted: keep what was provisioned as this project's spare. */
  abandon(sessionId: string): void {
    const record = this.records.get(sessionId)
    if (record === undefined) return
    this.forget(sessionId, record)
    if (record.provisioned === null || record.resolved === null) return
    record.ports.keepSpare({ ...record.provisioned, request: record.resolved })
  }

  dispose(): void {
    for (const sessionId of [...this.records.keys()]) this.abandon(sessionId)
  }

  /** Test seam: whether that Session still has a warm, and where it stands. */
  state(sessionId: string): { readonly settled: WarmRecord<Composer>['settled']; readonly name: string } | undefined {
    const record = this.records.get(sessionId)
    return record === undefined ? undefined : { settled: record.settled, name: record.name }
  }

  private fail(sessionId: string, record: WarmRecord<Composer>): void {
    if (this.records.get(sessionId) !== record) return
    record.settled = 'failed'
    this.forget(sessionId, record)
  }

  private forget(sessionId: string, record: WarmRecord<Composer> | undefined): void {
    if (record === undefined) return
    if (this.records.get(sessionId) !== record) return
    this.records.delete(sessionId)
    record.cancelTimer()
    record.controller.abort()
  }
}
