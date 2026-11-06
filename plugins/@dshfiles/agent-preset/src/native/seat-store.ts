/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * The new-session screen has no session, so a pick is staged rather than
 * applied. It reaches a session when one becomes current and is still blank —
 * whether the workspace connect created it or reused an existing blank one. A
 * flow that knows its preset before it starts (the settings section's creator
 * entry) passes it to session creation instead, and its stage only drives the
 * chip's display.
 *
 * The stage is forgotten once applied. The next new session starts from the
 * Host-effective default again.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@dshfiles/session-controller/draft-client'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { presetOptions, readRoster } from './settings-store.ts'
import type { AgentPresetOption } from './settings-store.ts'

/** A selection the Host refused, kept with its preset so the chip can name what failed. */
export interface PresetRefusal {
  readonly preset: AgentPresetOption
  readonly reason: string
}

/** Hero-chip snapshot. */
export interface AgentPresetSeatState {
  /** Presets the deployment supplies; empty means the chip renders nothing. */
  options: readonly AgentPresetOption[]
  /** The staged choice, empty until the roster loads. */
  current: string
  /** The error of the seat's phase: a refusal object while it announces, its reason after. */
  error: string | PresetRefusal | null
  busy: boolean
  /**
   * One-shot cue that the chip should introduce itself (the creator-draft
   * entry staged the pick from another screen, so the user never touched the
   * chip); the renderer clears it via `introduced()` once played.
   */
  introduce: boolean
}

const INITIAL: AgentPresetSeatState = {
  options: [], current: '', error: null, busy: false, introduce: false,
}

/**
 * The next session's pick, as one value every seat reads.
 *
 * The stage used to be a mutable object shared by every controller and edited
 * in place by the page's Developer-tools gate. Taking it is now a single
 * `consume()` that only one caller can win, which is what keeps a pick from
 * being spent twice when a list and a draft notification both land.
 */
export type AgentPresetStage =
  | { readonly kind: 'empty' }
  | {
    readonly kind: 'staged'
    readonly preset: string
    readonly introduce: boolean
    /** Creator navigation must not spend its stage on the previous blank. */
    readonly sourceSessionId: SessionSummary['id'] | null
  }

/** Where a staged pick waits; see {@link AgentPresetStage}. */
export class AgentPresetStageStore {
  private currentStage: AgentPresetStage = { kind: 'empty' }

  read(): AgentPresetStage {
    return this.currentStage
  }

  stage(input: {
    readonly preset: string
    readonly introduce?: boolean
    readonly sourceSessionId?: SessionSummary['id'] | null
  }): void {
    this.currentStage = {
      kind: 'staged',
      preset: input.preset,
      introduce: input.introduce ?? false,
      sourceSessionId: input.sourceSessionId ?? null,
    }
  }

  /** Take the stage out; the caller that receives it is the one that may apply it. */
  consume(): Extract<AgentPresetStage, { kind: 'staged' }> | null {
    const stage = this.currentStage
    if (stage.kind === 'empty') return null
    this.currentStage = { kind: 'empty' }
    return stage
  }

  introduced(): void {
    if (this.currentStage.kind === 'staged' && this.currentStage.introduce) {
      this.currentStage = { ...this.currentStage, introduce: false }
    }
  }

  clear(): void {
    this.currentStage = { kind: 'empty' }
  }
}

/**
 * The seat is idle, applying one Host selection, or announcing a refusal. The
 * chip snapshot is derived from this, so "busy" and a refusal can never show
 * together.
 */
type SeatPhase =
  | { readonly kind: 'idle'; readonly error: string | null }
  | { readonly kind: 'applying'; readonly settled: Promise<void> }
  | { readonly kind: 'refused'; readonly refusal: PresetRefusal }

/** Stages the next session's preset and applies it when one appears. */
export class AgentPresetSeatController {
  /** Chip snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSeatState> = createSnapshotStore(INITIAL)

  /**
   * The Host-effective default, so a consumed stage can fall back to it without
   * re-reading the roster.
   */
  private fallback = ''
  private options: readonly AgentPresetOption[] = []
  private phase: SeatPhase = { kind: 'idle', error: null }
  /** The one-shot introduction cue: armed by a stage from another screen, played once by the chip. */
  private cue = false

  /** Only the newest roster read may publish after overlapping refreshes. */
  private loadToken: object | null = null

  constructor(
    private readonly ctx: ClientContext,
    /** The session the hero is about to hand over to, when there is one. */
    private readonly currentSession: () => Pick<
      SessionSummary,
      'id' | 'blank' | 'projectionValues'
    > | undefined,
    private readonly stages: AgentPresetStageStore = new AgentPresetStageStore(),
  ) {}

  private publish(input: { readonly current?: string } = {}): void {
    const stage = this.stages.read()
    const phase = this.phase
    this.store.set({
      options: this.options,
      current: input.current ?? (stage.kind === 'staged' ? stage.preset : this.presetFor(this.currentSession())),
      error: phase.kind === 'refused' ? phase.refusal : phase.kind === 'idle' ? phase.error : null,
      busy: phase.kind === 'applying',
      introduce: this.cue,
    })
  }

  private presetFor(session: ReturnType<AgentPresetSeatController['currentSession']>): string {
    if (session === undefined) return this.fallback
    const draft = this.ctx.sessionDrafts.list.getSnapshot()[session.id]
    if (draft?.local) return draft.agentPreset ?? this.fallback
    return presetOf(session) ?? ''
  }

  /**
   * Read the roster and open the chip on the Host-effective default.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const token = {}
    this.loadToken = token
    const roster = await readRoster(this.ctx)
    if (this.loadToken !== token) return
    if (!roster.ok) {
      // A roster refresh can finish after a selection; leave its announcement for the chip.
      if (this.phase.kind === 'idle') this.phase = { kind: 'idle', error: roster.error }
      this.publish()
      return
    }
    const { presets } = roster.value
    this.fallback = presets.find(preset => preset.isDefault)?.id ?? presets[0]?.id ?? ''
    this.options = presetOptions(presets)
    // A stage that landed from another screen still owes its introduction on this chip.
    const staged = this.stages.read()
    this.cue = staged.kind === 'staged' ? staged.introduce : false
    // A late-landing load must not regress the display after an applied stage was consumed: the chip mounts (and
    // loads) only once the flow's session is current, so a successful read clears a plain message and keeps a refusal.
    if (this.phase.kind === 'idle') this.phase = { kind: 'idle', error: null }
    this.publish()
    await this.apply()
  }

  /**
   * Stage one preset for the next session, applying it immediately when a
   * blank session is already current.
   *
   * The refusal is stored for the chip's announcement and returned to callers
   * such as Settings that also report the result of their own write.
   * @param id - the preset to stage.
   * @returns the refusal text, or undefined once the pick settled.
   */
  async select(id: string): Promise<string | undefined> {
    if (this.phase.kind === 'applying') return undefined
    this.stage(id)
    return await this.apply()
  }

  /**
   * Stage a pick WITHOUT the immediate apply, for a flow that starts the
   * receiving session after the pick (the settings section's creator entry).
   * `select()`'s immediate apply would meet the still-current running session
   * and drop the stage as unservable; staging alone leaves it for the
   * list-change applier, which fires when the started session becomes
   * current.
   * @param id - the preset to stage.
   * @param introduce - true when the stage came from another screen and the
   * chip should announce itself on the session it lands on.
   */
  stage(id: string, introduce = false): void {
    this.cue = introduce
    this.stages.stage({ preset: id, introduce, sourceSessionId: introduce ? this.currentSession()?.id ?? null : null })
    if (this.phase.kind !== 'applying') this.phase = { kind: 'idle', error: null }
    this.publish({ current: id })
  }

  /** Acknowledge a displayed refusal without dismissing a newer attempt.
   * @param refusal - the selection error whose Toast finished.
   */
  dismissRefusal(refusal: AgentPresetSeatState['error']): void {
    if (refusal === null || typeof refusal !== 'object') return
    if (this.phase.kind !== 'refused' || this.phase.refusal !== refusal) return
    this.phase = { kind: 'idle', error: refusal.reason }
    this.publish()
  }

  /**
   * Capture the exact blank Session a Settings action may bring along.
   * @returns its id, or undefined outside a blank Session.
   */
  blankSessionId(): SessionSummary['id'] | undefined {
    const session = this.currentSession()
    return session?.blank === true ? session.id : undefined
  }

  /**
   * Apply a Settings choice only if its captured Session is still current and
   * blank after any pending selection settles. The selection uses the existing stage/apply path.
   * @param expectedSessionId - blank Session captured before the Settings write.
   * @param id - the effective default that the write persisted.
   * @returns the Host refusal text, or undefined when applied or no longer relevant.
   */
  async syncBlankSession(
    expectedSessionId: SessionSummary['id'],
    id: string,
  ): Promise<string | undefined> {
    while (this.phase.kind === 'applying') await this.phase.settled
    const session = this.currentSession()
    if (session === undefined || !session.blank || session.id !== expectedSessionId) return undefined
    this.stage(id)
    return await this.apply()
  }

  /** Acknowledge the introduction cue once the chip has played it. */
  introduced(): void {
    if (!this.cue) return
    this.cue = false
    this.stages.introduced()
    this.publish()
  }

  /**
   * Hand the staged choice to the current session, if there is one to take it.
   *
   * Called both by `select()` and by whoever observes the current session
   * changing, because the session may appear either before or after the pick.
   * List updates do not repeat a selection while its response is pending.
   * @returns this attempt's Host refusal, or undefined when successful or no switch starts.
   */
  async apply(): Promise<string | undefined> {
    if (this.phase.kind === 'applying') return undefined
    const stage = this.stages.read()
    const session = this.currentSession()
    if (stage.kind === 'empty') {
      this.publish()
      return undefined
    }
    if (session === undefined || stage.sourceSessionId === session.id) return undefined
    const target = stage.preset
    if (session.blank && this.ctx.sessionDrafts.list.getSnapshot()[session.id]?.local) {
      // Consume before publishing: metadata subscribers can re-enter apply synchronously.
      const consumed = this.stages.consume()
      if (consumed !== null) this.cue = consumed.introduce
      if (consumed !== null && this.ctx.sessionDrafts.stagePreset(session.id, consumed.preset)) {
        this.phase = { kind: 'idle', error: null }
        this.publish()
        return undefined
      }
      // Materialization may have won the identity. Only then use the native Host path.
    }
    // A started session's history was produced under its own composition; the
    // host refuses the swap, so the stage is no longer meaningful.
    if (!session.blank || presetOf(session) === target) {
      this.stages.clear()
      return undefined
    }
    const settled = Promise.withResolvers<void>()
    // Keep showing the pick while the Host answers; the stage itself is spent.
    const shown = this.store.getSnapshot().current
    this.phase = { kind: 'applying', settled: settled.promise }
    this.stages.clear()
    this.publish({ current: shown })
    const refuse = (reason: string): string => {
      this.phase = {
        kind: 'refused',
        refusal: { reason, preset: this.options.find(option => option.id === target) ?? { id: target } },
      }
      this.publish({ current: presetOf(session) ?? '' })
      return reason
    }
    try {
      const result = await this.ctx.remote.agentPresets.select(session.id, target)
      if (!result.ok) {
        const { error } = result
        // Prefer the bare cause; the Toast already names the rejected preset.
        const refusal = 'reason' in error.details && typeof error.details.reason === 'string'
          ? error.details.reason
          : error.message
        return refuse(refusal)
      }
      this.phase = { kind: 'idle', error: null }
      this.publish({ current: result.value })
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error))
    } finally {
      settled.resolve()
    }
  }
}

function presetOf(
  session: Pick<SessionSummary, 'projectionValues'> | undefined,
): string | undefined {
  const value = session?.projectionValues?.agentPreset
  return typeof value === 'string' ? value : undefined
}
