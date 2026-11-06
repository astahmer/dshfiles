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
