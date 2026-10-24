import { describe, expect, test } from 'vitest'
import { backlogApi } from './api.js'

describe('backlog tool exposure', () => {
  test('comments allow attachment-only replies but reject empty replies', async () => {
    const schema = backlogApi.methods.comment.input
    if (schema === undefined) throw new Error('Comment input schema is missing')
    const image = {
      id: 'c711b896-58bc-4a23-b4fa-2148657bc21a',
      kind: 'image',
      name: 'screenshot.png',
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
      data: 'iVBORw==',
    }

    const validate = (value: unknown) => schema['~standard'].validate(value)

    expect((await validate({ id: 1, text: '', files: [image] })).issues).toBeUndefined()
    expect((await validate({ id: 1, text: 'Progress update' })).issues).toBeUndefined()
    expect((await validate({ id: 1, text: '  ' })).issues).toBeDefined()
    expect((await validate({ id: 1, text: '', files: [] })).issues).toBeDefined()
  })
  test('every panel verb a human can take is a named tool', () => {
    const tools = Object.values(backlogApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'backlog_accept_proposal',
      'backlog_attach_file',
      'backlog_capture',
      'backlog_comment',
      'backlog_delete',
      'backlog_dismiss_proposal',
      'backlog_get',
      'backlog_get_many',
      'backlog_link',
      'backlog_list',
      'backlog_projects',
      'backlog_read_file',
      'backlog_referencing',
      'backlog_remove_file',
      'backlog_start_thread',
      'backlog_triage',
      'backlog_triage_backfill',
      'backlog_triage_backfill_status',
      'backlog_update',
    ])
  })

  test('reads stay read-only and every write says the user must have asked', () => {
    const readOnly = Object.values(backlogApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual([
      'backlog_get',
      'backlog_get_many',
      'backlog_list',
      'backlog_projects',
      'backlog_read_file',
      'backlog_referencing',
      'backlog_triage_backfill_status',
    ])
  })

  test('item-returning tools render a compact linked preview instead of raw JSON', () => {
    const item = {
      id: 42,
      title: 'A linked backlog item',
      body: 'First line\nsecond line',
      kind: 'task' as const,
      status: 'doing' as const,
      project: null,
      tags: [],
      links: [],
      attachments: [],
      actors: [],
      pinned: false,
      humanFields: [],
      createdAt: 1,
      lastActivityAt: 1,
      events: [],
      freshness: 'fresh' as const,
    }
    const render = backlogApi.methods.get.tool?.render
    expect(render).toBeTypeOf('function')
    expect(render?.({ ok: true, value: { item, backlinks: [] } })).toBe(['b:42 — A linked backlog item', 'task · doing', 'First line second line'].join('\n'))
    for (const name of ['capture', 'get', 'attachFile', 'removeFile', 'update', 'link', 'triage', 'applyProposal', 'dismissProposal', 'comment'] as const) {
      expect(backlogApi.methods[name].tool?.render).toBeTypeOf('function')
    }
  })

  test('every tool explains itself', () => {
    for (const method of Object.values(backlogApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
    }
  })

  test('comments accept an attachment-only reply, but reject an empty comment', () => {
    const input = backlogApi.methods.comment.input
    if (input === undefined) throw new Error('Comment input schema is missing.')
    const validate = (value: unknown): boolean => {
      const result = input['~standard'].validate(value)
      return !('issues' in result)
    }
    expect(
      validate({
        id: 1,
        text: '',
        files: [{ id: 'reply-image-1', kind: 'image', name: 'reply.png', mediaType: 'image/png', bytes: 3, data: 'aGk=' }],
      }),
    ).toBe(true)
    expect(validate({ id: 1, text: '' })).toBe(false)
  })

  test('item writes name the bar for acting on their own', () => {
    for (const name of [
      'capture',
      'update',
      'link',
      'comment',
      'attachFile',
      'removeFile',
      'delete',
      'applyProposal',
      'dismissProposal',
      'backfillTriage',
      'startThread',
    ] as const) {
      expect(backlogApi.methods[name].description ?? '').toMatch(/Use it when the user asked/u)
    }
  })

  test('presentation and transport methods stay untooled on purpose', () => {
    for (const name of ['revision', 'speechStatus', 'jevSetupStatus', 'classifyReply', 'transcribeSpeech', 'acknowledge'] as const) {
      expect(backlogApi.methods[name].tool).toBeUndefined()
    }
  })
})
