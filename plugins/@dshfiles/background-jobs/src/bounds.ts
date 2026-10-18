/**
 * Wire bounds for a job row. The live registry keeps whatever the producer
 * registered — a `bash` label is the command line, a `pty-send` label is the
 * whole text a Session typed — so every row crossing the API is clamped to
 * the bound `jobRowSchema` declares. The history index writes these bounds to
 * disk; the live path applies the same ones so both faces agree.
 */

export const MAX_LABEL_LENGTH = 2_000
export const MAX_KIND_LENGTH = 64
export const MAX_PROGRESS_LENGTH = 300
export const MAX_DETAIL_LENGTH = 500
export const MAX_SPILL_PATH_LENGTH = 1_000
export const MAX_SPILL_PATHS = 8

export const clampText = ({ text, limit }: { readonly text: string; readonly limit: number }): string => (text.length > limit ? text.slice(0, limit) : text)

/** A JSONL frame cannot carry CR or NUL; a row's label is one bounded line. */
export const boundedLabel = (label: string): string => clampText({ text: label.replaceAll('\r', '').replaceAll('\u0000', ''), limit: MAX_LABEL_LENGTH })
