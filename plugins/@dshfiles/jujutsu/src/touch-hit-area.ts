/**
 * Under a coarse pointer, an invisible hit box 8 px past each edge of a compact control (a 28 px icon button becomes a
 * 44 px target) while the toolbar and the rows keep their compact height.
 */
export const TOUCH_HIT_AREA = "dshx:relative dshx:pointer-coarse:after:absolute dshx:pointer-coarse:after:-inset-2 dshx:pointer-coarse:after:content-['']"
