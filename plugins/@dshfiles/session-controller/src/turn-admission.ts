import * as Schema from 'effect/Schema'

/** How many threads may run a turn at once; 0 is unlimited, the native behaviour. */
export const turnAdmissionPolicySchema = Schema.Struct({
  maxRunningThreads: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(64)),
  /** Whether running subagent sessions take a slot. They are never held themselves: delegation starts them. */
  countSubagents: Schema.Boolean,
})

export type TurnAdmissionPolicy = typeof turnAdmissionPolicySchema.Type

export const DEFAULT_TURN_ADMISSION_POLICY: TurnAdmissionPolicy = { maxRunningThreads: 0, countSubagents: false }

/** One prompt parked in its thread's inbox until a slot frees. */
export interface HeldPrompt {
  readonly sessionId: string
  readonly messageId: string
  readonly mode: 'followup' | 'steer'
  readonly heldAt: number
}

export const heldPromptViewSchema = Schema.Struct({
  sessionId: Schema.String,
  heldAt: Schema.Number,
  /** Prompts that start before this one. */
  ahead: Schema.Number,
})

export const turnAdmissionSnapshotSchema = Schema.Struct({
  policy: turnAdmissionPolicySchema,
  running: Schema.Number,
  waiting: Schema.Array(heldPromptViewSchema),
})

export type TurnAdmissionSnapshot = typeof turnAdmissionSnapshotSchema.Type

/** What the queue needs from the Host: the running count and a way to start one parked prompt. */
export interface TurnAdmissionPorts {
  readonly running: (countSubagents: boolean) => number
  /** Start the parked prompt; false when it is no longer pending (edited, removed, or already started). */
  readonly release: (held: HeldPrompt) => boolean
  readonly changed: (snapshot: TurnAdmissionSnapshot) => void
}

/**
 * FIFO admission for new turns. A prompt for an idle thread waits while the cap is reached or earlier prompts still
 * wait; a turn ending pumps the queue. Prompts to a running thread are never held: the native queue already orders them.
 */
export class TurnAdmissionQueue {
  private policy: TurnAdmissionPolicy = DEFAULT_TURN_ADMISSION_POLICY
  private readonly waiting: HeldPrompt[] = []

  constructor(private readonly ports: TurnAdmissionPorts) {}

  configure(policy: TurnAdmissionPolicy): void {
    this.policy = policy
    this.pump()
    this.publish()
  }

  shouldHold(): boolean {
    if (this.policy.maxRunningThreads === 0) return false
    return this.waiting.length > 0 || this.ports.running(this.policy.countSubagents) >= this.policy.maxRunningThreads
  }

  hold(held: HeldPrompt): void {
    this.waiting.push(held)
    this.publish()
  }

  /** Release waiting prompts while slots are free, oldest first. */
  pump(): void {
    let changed = false
    let free = this.policy.maxRunningThreads === 0 ? Number.POSITIVE_INFINITY : this.policy.maxRunningThreads - this.ports.running(this.policy.countSubagents)
    while (free > 0 && this.waiting.length > 0) {
      const next = this.waiting.shift()
      changed = true
      if (next !== undefined && this.ports.release(next)) free -= 1
    }
    if (changed) this.publish()
  }

  /**
   * Start a thread's waiting prompts now, past the cap.
   * @returns how many prompts started.
   */
  forceStart(sessionId: string): number {
    const mine = this.waiting.filter(held => held.sessionId === sessionId)
    if (mine.length === 0) return 0
    this.waiting.splice(0, this.waiting.length, ...this.waiting.filter(held => held.sessionId !== sessionId))
    const started = mine.filter(held => this.ports.release(held)).length
    this.publish()
    return started
  }

  /** Forget a thread's waiting prompts, when its Agent left. */
  drop(sessionId: string): void {
    const before = this.waiting.length
    this.waiting.splice(0, this.waiting.length, ...this.waiting.filter(held => held.sessionId !== sessionId))
    if (this.waiting.length !== before) this.publish()
  }

  snapshot(): TurnAdmissionSnapshot {
    return {
      policy: this.policy,
      running: this.ports.running(this.policy.countSubagents),
      waiting: this.waiting.map((held, index) => ({ sessionId: held.sessionId, heldAt: held.heldAt, ahead: index })),
    }
  }

  private publish(): void {
    this.ports.changed(this.snapshot())
  }
}
