import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputTriggerSource } from '@dshfiles/input-trigger/types'
import { Option, Schema } from 'effect'
import { forgeSearchItemSchema, type ForgeSearchItem, type ForgeSearchUnavailable } from './pull-request-model.js'

const decode = (ref: string): ForgeSearchItem | null => Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(forgeSearchItemSchema))(ref))

const label = (item: ForgeSearchItem): string => `#${String(item.number)} ${item.title}`

/** What one `#` search found: items, or why the forge cannot be searched (b:ysaj). */
export interface ForgeSearchResult {
  readonly items: readonly ForgeSearchItem[]
  readonly unavailable?: ForgeSearchUnavailable | undefined
}

/** The command a recovery row copies. */
const RECOVERY_COMMAND: Record<ForgeSearchUnavailable['reason'], string> = {
  'gh-missing': 'https://cli.github.com',
  'signed-out': 'gh auth login',
}
const RECOVERY_VALUE = 'recovery:'

/** One row instead of an empty list: what to do so `#` can list issues and pull requests. */
const recoveryCandidate = (unavailable: ForgeSearchUnavailable) => ({
  name: unavailable.reason === 'signed-out' ? 'gh auth login' : 'Install gh',
  label: unavailable.reason === 'signed-out' ? 'Sign in with gh auth login to list issues' : 'Install the GitHub CLI to list issues',
  description:
    unavailable.reason === 'signed-out'
      ? 'Run it in a terminal, then type # again. Choose this row to copy the command.'
      : 'Get it from cli.github.com, then type # again. Choose this row to copy the link.',
  value: `${RECOVERY_VALUE}${unavailable.reason}`,
})

export class ForgeMentions {
  static create(options: {
    readonly search: (sessionId: string, query: string, signal: AbortSignal) => Promise<ForgeSearchResult>
    /** Copies a recovery command; defaults to the clipboard. */
    readonly copy?: (text: string) => void
  }): InputTriggerSource {
    // writeClipboard falls back where navigator.clipboard is missing (a plain-HTTP LAN or tailnet page).
    const copy = options.copy ?? ((text: string): void => void writeClipboard(text).catch(() => undefined))
    return {
      trigger: '#',
      name: 'forge',
      showGroupTitle: false,
      async candidates(session, request) {
        const result = await options.search(session.sessionId, request.query, request.signal)
        if (result.unavailable !== undefined) return [recoveryCandidate(result.unavailable)]
        return result.items.map(item => ({
          name: `#${String(item.number)}`,
          label: item.title,
          description: `${item.isPullRequest ? 'Pull request' : 'Issue'} · ${item.state}`,
          value: JSON.stringify(item),
        }))
      },
      onPick({ candidate }) {
        const value = candidate.value ?? ''
        if (value.startsWith(RECOVERY_VALUE)) {
          const reason = value.slice(RECOVERY_VALUE.length)
          if (reason === 'gh-missing' || reason === 'signed-out') copy(RECOVERY_COMMAND[reason])
          return undefined
        }
        const item = decode(value)
        if (item === null) return undefined
        return { insert: { source: 'forge', ref: JSON.stringify(item), label: label(item), clipboardText: item.url } }
      },
      codec: {
        clipboardText(ref) {
          return decode(ref)?.url ?? 'Invalid forge reference'
        },
        async serialize(ref, signal) {
          signal.throwIfAborted()
          const item = decode(ref)
          if (item === null) throw new Error('Invalid forge reference.')
          return `${label(item)} (${item.url})`
        },
      },
    }
  }
}
