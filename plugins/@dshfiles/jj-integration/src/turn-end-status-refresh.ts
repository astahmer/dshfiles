/**
 * The newest Turn's tail reads the thread status while the Turn runs, so its cached answer predates the work the Turn
 * described. One read at the moment the Turn ends is what makes the integration offer appear at once instead of after
 * the fallback poll; this keeps that read to one per Turn and skips Tails mounted after their Turn already ended,
 * which the query read fresh on mount.
 */
export class TurnEndStatusRefresh {
  private refreshedEndAt: number | null

  constructor(mountedEndAt: number | undefined) {
    this.refreshedEndAt = mountedEndAt ?? null
  }

  /** @returns whether the caller should refetch the status for this Turn end. */
  take(input: { readonly newestTurnHasEnded: boolean; readonly endedAt: number | undefined }): boolean {
    if (!input.newestTurnHasEnded || input.endedAt === undefined || this.refreshedEndAt === input.endedAt) return false
    this.refreshedEndAt = input.endedAt
    return true
  }
}
