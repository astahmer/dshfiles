/** Presentation constants of the review surfaces (round five P7, A4). */
export class ReviewLook {
  /**
   * Retired (round five A4): the kit's `PatchView` now owns the diff surfaces in both schemes (a ramp body, 12% add and
   * delete tints, a soft collapsed-lines bar and the shared syntax pair) as inline custom properties, which a class on
   * the same element cannot override. Kept empty so existing call sites compile; drop it from them.
   */
  static readonly DARK_DIFF_TINTS = ''

  /** Review progress: a 128 × 4 px bar beside its "n/m reviewed" count, not a rule across the page. */
  static readonly PROGRESS = 'dshx:h-1 dshx:w-32 dshx:flex-none'

  /**
   * A file's Reviewed control: checkbox and word in one bounded 32 px box (44 px under a coarse pointer, council round 4,
   * D3), on the fields' 3:1 boundary with its label in full ink, so it reads as a control (council round 6, D2).
   */
  static readonly REVIEWED_TOGGLE =
    'dshx:inline-flex dshx:h-8 dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-field-border dshx:bg-background dshx:px-2.5 dshx:text-xs dshx:font-medium dshx:text-foreground dshx:transition-colors dshx:hover:bg-accent dshx:pointer-coarse:h-11'
}
