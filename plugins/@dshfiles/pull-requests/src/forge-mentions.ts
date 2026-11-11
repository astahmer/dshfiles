import type { InputTriggerSource } from '@dshfiles/input-trigger/types'
import { Option, Schema } from 'effect'
import { forgeSearchItemSchema, type ForgeSearchItem } from './pull-request-model.js'

const decode = (ref: string): ForgeSearchItem | null => Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(forgeSearchItemSchema))(ref))

const label = (item: ForgeSearchItem): string => `#${String(item.number)} ${item.title}`

export class ForgeMentions {
  static create(options: {
    readonly search: (sessionId: string, query: string, signal: AbortSignal) => Promise<readonly ForgeSearchItem[]>
  }): InputTriggerSource {
    return {
      trigger: '#',
      name: 'forge',
      showGroupTitle: false,
      async candidates(session, request) {
        const items = await options.search(session.sessionId, request.query, request.signal)
        return items.map(item => ({
          name: `#${String(item.number)}`,
          label: item.title,
          description: `${item.isPullRequest ? 'Pull request' : 'Issue'} · ${item.state}`,
          value: JSON.stringify(item),
        }))
      },
      onPick({ candidate }) {
        const item = decode(candidate.value ?? '')
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
