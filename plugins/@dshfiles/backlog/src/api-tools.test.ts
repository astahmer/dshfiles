import { Result, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { backlogApi } from './api.js'
import { BacklogItems } from './item.js'

describe('backlog tool exposure', () => {
  test('item ids take a number from an older caller or a written reference, and reject anything else', () => {
    const get = backlogApi.methods.get.input
    const getMany = backlogApi.methods.getMany.input
    if (get === undefined || getMany === undefined) throw new Error('Get input schemas are missing')
    const validate = Schema.decodeUnknownResult(get)
    for (const id of [12, '12', 'b:12', 'k3f9', 'b:k3f9', 'K3F9', '7hq2x']) expect(Result.isSuccess(validate({ id }))).toBe(true)
    for (const id of [0, -1, 1.5, '', 'b:', 'todo', 'k3f', 'k3f9xyz', 'b:0', 'session-abc']) expect(Result.isFailure(validate({ id }))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(getMany)({ ids: [12, 'b:k3f9'] }))).toBe(true)
  })

  test('empty actor filters mean no filter without weakening actor ID validation', async () => {
    const schema = backlogApi.methods.list.input
    if (schema === undefined) throw new Error('List input schema is missing')
    const validate = Schema.decodeUnknownResult(schema)

    expect(Schema.is(BacklogItems.actorIdSchema)('')).toBe(false)
    const emptyActor = validate({ actor: '' })
    if (Result.isFailure(emptyActor)) throw new Error('Empty actor should be normalized to no filter')
    expect(emptyActor.success).toMatchObject({ actor: undefined })
    for (const actor of ['user', 'system', 'agent:session-123']) {
      expect(Result.isSuccess(validate({ actor }))).toBe(true)
    }
    for (const actor of ['agent:', 'other']) {
      expect(Result.isFailure(validate({ actor }))).toBe(true)
    }
  })

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

    const validate = Schema.decodeUnknownResult(schema)

    expect(Result.isSuccess(validate({ id: 1, text: '', files: [image] }))).toBe(true)
    expect(Result.isSuccess(validate({ id: 1, text: 'Progress update' }))).toBe(true)
    expect(Result.isFailure(validate({ id: 1, text: '  ' }))).toBe(true)
    expect(Result.isFailure(validate({ id: 1, text: '', files: [] }))).toBe(true)
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
      'backlog_enrich_tweet',
      'backlog_get',
      'backlog_get_many',
      'backlog_import_remote',
      'backlog_link',
      'backlog_link_remote',
      'backlog_list',
      'backlog_projects',
      'backlog_read_file',
      'backlog_referencing',
      'backlog_remove_file',
      'backlog_start_thread',
      'backlog_sync_now',
      'backlog_sync_status',
      'backlog_sync_test_all',
      'backlog_sync_test_connection',
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
      'backlog_sync_status',
      'backlog_sync_test_all',
      'backlog_sync_test_connection',
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
    const decode = Schema.decodeUnknownResult(input)
    expect(
      Result.isSuccess(
        decode({
          id: 1,
          text: '',
          files: [{ id: 'reply-image-1', kind: 'image', name: 'reply.png', mediaType: 'image/png', bytes: 3, data: 'aGk=' }],
        }),
      ),
    ).toBe(true)
    expect(Result.isSuccess(decode({ id: 1, text: '' }))).toBe(false)
  })

  test('item writes name the bar for acting on their own', () => {
    for (const name of [
      'capture',
      'update',
      'link',
      'comment',
      'attachFile',
      'enrichTweet',
      'removeFile',
      'delete',
      'applyProposal',
      'dismissProposal',
      'backfillTriage',
      'startThread',
      'syncNow',
      'linkRemote',
      'importRemote',
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
