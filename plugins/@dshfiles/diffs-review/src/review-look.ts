/** Presentation constants of the review surfaces (round five P7). */
export class ReviewLook {
  /**
   * The diff library mixes 20 % of its addition and deletion hues into a dark line, which glares on a dark page. In dark
   * the lines take the status `-bg` tokens (12 %) instead, through the library's inherited override properties (its
   * shadow roots only see inherited custom properties). Light keeps the library's own scheme.
   */
  static readonly DARK_DIFF_TINTS =
    'dshx:dark:[--diffs-bg-addition-override:var(--dshx-tone-success-bg)] dshx:dark:[--diffs-bg-deletion-override:var(--dshx-tone-danger-bg)]'

  /** Review progress: a 128 × 4 px bar beside its "n/m reviewed" count, not a rule across the page. */
  static readonly PROGRESS = 'dshx:h-1 dshx:w-32 dshx:flex-none'
}
