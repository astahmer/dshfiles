import { describe, expect, test } from 'vitest'
import { backlogApi } from './api.js'

describe('backlog tool exposure', () => {
  test('every panel verb a human can take is a named tool', () => {
    const tools = Object.values(backlogApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'backlog_accept_proposal',
      'backlog_attach_file',
      'backlog_capture',
      'backlog_comment',
      'backlog_dismiss_proposal',
      'backlog_get',
      'backlog_get_many',
      'backlog_link',
      'backlog_list',
      'backlog_projects',
      'backlog_read_file',
      'backlog_referencing',
      'backlog_remove_file',
      'backlog_triage',
      'backlog_update',
    ])
  })

  test('reads stay read-only and every write says the user must have asked', () => {
    const readOnly = Object.values(backlogApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual(['backlog_get', 'backlog_get_many', 'backlog_list', 'backlog_projects', 'backlog_read_file', 'backlog_referencing'])
  })

  test('every tool explains itself', () => {
    for (const method of Object.values(backlogApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
    }
  })

  test('item writes name the bar for acting on their own', () => {
    for (const name of ['capture', 'update', 'link', 'comment', 'attachFile', 'removeFile', 'applyProposal', 'dismissProposal'] as const) {
      expect(backlogApi.methods[name].description ?? '').toMatch(/Use it when the user asked/u)
    }
  })

  test('presentation and transport methods stay untooled on purpose', () => {
    for (const name of ['revision', 'speechStatus', 'transcribeSpeech', 'acknowledge'] as const) {
      expect(backlogApi.methods[name].tool).toBeUndefined()
    }
  })
})
