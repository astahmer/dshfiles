import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'

const SUBAGENT_CHAT_ADDRESS = 'dsh-resource://subagentchat/session/'

export const subagentChatAddress = (address: SubagentAddress): string => {
  const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
  return `${SUBAGENT_CHAT_ADDRESS}${encodeURIComponent(address.childSessionId)}?${query}`
}
