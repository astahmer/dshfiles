import { describe, expect, test } from 'vitest'
import { agentCommunicationApi } from './api.js'
import { communicationTools } from './communication-tools.js'

describe('agent-communication tool exposure', () => {
  test('low-use panel and discovery methods remain APIs but are not Agent tools', () => {
    expect(Object.values(agentCommunicationApi.methods).every(method => method.tool === undefined)).toBe(true)
    expect(Object.keys(agentCommunicationApi.methods)).toEqual([
      'diagnostics',
      'browseMessages',
      'postMessage',
      'messageRecipients',
      'revealMessageBody',
      'setSubscription',
      'unsubscribe',
      'acknowledge',
    ])
  })

  test('the Agent keeps only peer discovery, send, inbox, and acknowledgement tools', () => {
    expect(communicationTools.map(tool => tool.name)).toEqual(['dshx_comm_agents', 'dshx_comm_send', 'dshx_comm_inbox', 'dshx_comm_ack'])
  })
})
