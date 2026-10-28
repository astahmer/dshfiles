import { useEffect } from 'react'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ComposerActionProps } from '@dshfiles/dshx/client'
import { MAX_RECENT_SCAN_NODES, projectRecentPrompts, type RecentPrompt } from './recent-prompts.js'

export type PromptActionProps = Omit<ComposerActionProps, 'useChat'> & {
  readonly useChat?: ComposerActionProps['useChat']
}

type ChatNodePayload = {
  readonly data: unknown
}

type ChatNodes = {
  readonly order: readonly string[]
  readonly nodes: { get(key: string): ChatNodePayload | undefined }
}

type ChatSourceProps<Selected> = {
  readonly useChat: ComposerActionProps['useChat']
  readonly selector: (snapshot: ChatSnapshot) => Selected
  readonly isEqual?: (left: Selected, right: Selected) => boolean
  readonly onChange: (selected: Selected) => void
}

const newestFirstNodes = (chat: ChatNodes): Iterable<ChatNodePayload | undefined> => ({
  *[Symbol.iterator]() {
    let index = chat.order.length - 1
    let scanned = 0
    while (index >= 0 && scanned < MAX_RECENT_SCAN_NODES) {
      const key = chat.order[index]
      if (key !== undefined) yield chat.nodes.get(key)
      index -= 1
      scanned += 1
    }
  },
})

export const selectRecentPrompts = (chat: ChatNodes): readonly RecentPrompt[] => projectRecentPrompts(newestFirstNodes(chat))

/**
 * Subscribes to the Chat hook only while a Chat provider exists. The composer
 * also renders without a Session binding, where `useChat` is absent; a child
 * source keeps the parent's hook order stable in both states.
 */
export const ChatSource = <Selected,>({ useChat, selector, isEqual, onChange }: ChatSourceProps<Selected>): null => {
  const selected = useChat(selector, isEqual)

  useEffect(() => {
    onChange(selected)
  }, [onChange, selected])

  return null
}
