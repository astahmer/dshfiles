import { Schema } from 'effect'

/** How much of the command a row's detail line shows; the card shows the whole of it. */
const SUBJECT_LENGTH = 27
/** A cut never leaves fewer characters than this before a word break. */
const MIN_WORD_CUT = 12

/** The live step's shell form ("Running pnpm test"); the bare fallback names no command. */
const RUNNING_PREFIX = 'Running '
const NAMELESS_STEP = 'Running a command'

const reasonField = Schema.Struct({ reason: Schema.String })
const isText = Schema.is(Schema.String)

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim().replace(/…$/u, '')
  if (line.length <= SUBJECT_LENGTH) return line
  const head = line.slice(0, SUBJECT_LENGTH)
  const space = head.lastIndexOf(' ')
  return `${(space >= MIN_WORD_CUT ? head.slice(0, space) : head).trimEnd()}…`
}

/**
 * What a thread waiting on a tool approval asks, for its row's detail line (DESIGN.md: "Waiting on you is Needs you,
 * whatever asks"): the command the live step names, else the reason the tool gave, clipped to 27 characters. The
 * approval itself is decided on its card, where the whole command shows. A plan review, or an approval with neither,
 * has no detail and the row says Needs you.
 */
const subjectOf = (input: { readonly kind: string | undefined; readonly step: string | null | undefined; readonly reason?: unknown }): string | undefined => {
  if (input.kind !== 'approval') return undefined
  const step = input.step ?? ''
  if (step.startsWith(RUNNING_PREFIX) && step !== NAMELESS_STEP) return clip(step.slice(RUNNING_PREFIX.length))
  if (isText(input.reason) && input.reason.trim() !== '') return clip(input.reason)
  return undefined
}

/** The pending interaction's own reason, when its domain carries one (the approval request's). */
const reasonOf = (interaction: unknown): unknown => (Schema.is(reasonField)(interaction) ? interaction.reason : undefined)

export class ApprovalDetail {
  static readonly subjectOf = subjectOf
  static readonly reasonOf = reasonOf
  /**
   * @param input - the pending interaction's kind, the thread's live step and the request's reason.
   * @param format - the locale's "Approve: {command}" sentence.
   * @returns the detail line, or undefined when nothing names what waits.
   */
  static of(
    input: { readonly kind: string | undefined; readonly step: string | null | undefined; readonly reason?: unknown },
    format: (subject: string) => string = subject => `Approve: ${subject}`,
  ): string | undefined {
    const subject = subjectOf(input)
    return subject === undefined ? undefined : format(subject)
  }
}
