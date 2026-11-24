import type { FollowIntent } from './use-scroll-follow.ts'

/**
 * One transcript follow intent: at the tail, or reading a saved position. A reader movement that
 * still awaits interval or scrollend sampling is a pending sample of the same intent, so a
 * published follow state and a pending sample cannot disagree about who owns the scrollport.
 */
export type ReadingPolicy =
  | { readonly kind: 'following'; readonly sample: 'idle' | 'pending' }
  | { readonly kind: 'reading'; readonly sample: 'idle' | 'pending' }

/** Follow intent owned by the Chat reading policy and written through by its scroll controller. */
export class ReadingFollowIntent implements FollowIntent {
  private policy: ReadingPolicy

  constructor(following: boolean) {
    this.policy = { kind: following ? 'following' : 'reading', sample: 'idle' }
  }

  get following(): boolean { return this.policy.kind === 'following' }

  /** @returns whether reader movement awaits interval or scrollend sampling. */
  get pending(): boolean { return this.policy.sample === 'pending' }

  setFollowing(following: boolean): void {
    this.policy = { kind: following ? 'following' : 'reading', sample: this.policy.sample }
  }

  /** Reader movement became pending; intake and follow tail stay undecided until it settles. */
  beginSample(): void {
    this.policy = { kind: this.policy.kind, sample: 'pending' }
  }

  /** The sample settled, was superseded, or the policy was released for an explicit navigation. */
  endSample(): void {
    this.policy = { kind: this.policy.kind, sample: 'idle' }
  }
}

/** The committed facts that decide whether new content is the reader's own input. */
export interface OwnInputFacts {
  readonly lastKey: string | null
  readonly lastIsUser: boolean
  readonly steeringId: string | null
  readonly submissionId: string | null
  /** Key of the question or approval this thread waits on, if any. */
  readonly pendingInteraction: string | null
}

/**
 * Whether the reader's own input arrived since the last applied facts: a message they sent, a steer, a submission,
 * or (dshfiles, round three F6) an answer to the question the thread waited on. Own input follows the tail, so the
 * reply it starts comes into view as after Send; a question replaced by the next one still waits on the reader.
 * @param previous - facts last applied, or null before the first.
 * @param current - facts of this commit.
 * @returns whether to follow, and whether the input steers or submits.
 */
export function ownInputOf(
  previous: OwnInputFacts | null,
  current: OwnInputFacts,
): { readonly own: boolean; readonly steering: boolean; readonly submission: boolean } {
  const steering = current.steeringId !== null && current.steeringId !== previous?.steeringId
    && current.steeringId !== previous?.submissionId
  const submission = current.submissionId !== null && current.submissionId !== previous?.submissionId
    && current.submissionId !== previous?.steeringId
  const answered = previous !== null && previous.pendingInteraction !== null && current.pendingInteraction === null
  const sent = current.lastIsUser && current.lastKey !== previous?.lastKey
  return { own: sent || steering || submission || answered, steering, submission }
}
