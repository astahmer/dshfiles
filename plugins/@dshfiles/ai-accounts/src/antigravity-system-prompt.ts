/**
 * Google answers 429 RESOURCE_EXHAUSTED to two parts of DSH's system prompt: the harness-identity opener, and the
 * harness dev context that names this checkout and its Web GUI. An Antigravity turn therefore sends neither — the
 * opener becomes neutral and the two dev-context paragraphs are left out — while every other instruction stays.
 *
 * The frozen prefixes cover the paragraphs older Sessions still carry: DSH keeps a Session's admitted dev context
 * verbatim, so a prompt written by an earlier release still holds the older wording.
 */

const HARNESS_IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'

const NEUTRAL_IDENTITY = 'You are an AI coding agent.'

/** The `harness:source` section, current and frozen. */
const HARNESS_SOURCE_PREFIXES = [
  'The runtime context names the DeepSeek Harness implementation checkout.',
  'The DeepSeek Harness implementation checkout is at ',
] as const

/** The `app:web-surface` section, current and frozen. */
const WEB_SURFACE_PREFIXES = ['You are interacting with the user through the DeepSeek Harness Web GUI'] as const

const startsWithAny = (paragraph: string, prefixes: readonly string[]): boolean => prefixes.some(prefix => paragraph.startsWith(prefix))

/** DSH's prompt with the parts Google rejects replaced by a neutral opener and nothing else. */
export const neutralSystemPrompt = (system: string): string =>
  system
    .split(/\n{2,}/u)
    .filter(paragraph => !startsWithAny(paragraph, HARNESS_SOURCE_PREFIXES) && !startsWithAny(paragraph, WEB_SURFACE_PREFIXES))
    .map(paragraph => (paragraph.trim() === HARNESS_IDENTITY ? NEUTRAL_IDENTITY : paragraph))
    .join('\n\n')
