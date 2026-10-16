import { describe, expect, test } from 'vitest'
import { agentCommunicationApi } from './api.js'

describe('agent-communication tool exposure', () => {
  test('the panel reads are named, read-only tools', () => {
    const tools = Object.values(agentCommunicationApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual(['dshx_comm_browse', 'dshx_comm_diagnostics', 'dshx_comm_recipients'])
    expect(tools.every(tool => tool.readOnly === true)).toBe(true)
    for (const method of Object.values(agentCommunicationApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
    }
  })

  test('the message write verbs stay client-only for now', () => {
    for (const name of ['postMessage', 'setSubscription', 'unsubscribe', 'acknowledge'] as const) {
      expect(agentCommunicationApi.methods[name].tool).toBeUndefined()
    }
  })
})
