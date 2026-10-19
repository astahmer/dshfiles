import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { RegistryListing } from '@dshfiles/dshx/api'
import { createMcpMentionSource, McpMentionModel } from './mcp-mentions.js'

const registryListing = (tools: RegistryListing['tools']): RegistryListing => ({ apis: [], tools, skills: [] })

test('decodes MCP tools without letting unrelated long descriptions hide them', () => {
  assert.deepEqual(
    McpMentionModel.decodeTools(
      registryListing([
        { name: 'mcp__figma__create_frame', description: 'Create a frame', source: 'mcp' },
        { name: 'workspace.read', description: 'Read a file', source: 'tool' },
        { name: 'long.api', description: 'a'.repeat(1_500), source: 'api' },
      ]),
    ),
    [{ name: 'mcp__figma__create_frame', description: 'Create a frame' }],
  )
  assert.equal(
    McpMentionModel.decodeTools(registryListing([{ name: 'mcp__long', description: 'a'.repeat(1_500), source: 'mcp' }]))[0]?.description.length,
    1_024,
  )
})

test('maps ranked MCP servers and tools into distinct @ sections', () => {
  const candidates = McpMentionModel.candidates({
    rankedServers: [{ displayName: 'Figma Design', serverName: 'figma', name: 'figma Figma Design' }],
    rankedTools: [{ name: 'mcp__figma__create_frame', description: 'Create a frame' }],
    serverSection: 'MCP servers',
    toolSection: 'MCP tools',
  })

  assert.deepEqual(
    candidates.map(candidate => ({ name: candidate.name, label: candidate.label, section: candidate.section })),
    [
      { name: 'figma', label: 'Figma Design', section: 'MCP servers' },
      { name: 'mcp__figma__create_frame', label: undefined, section: 'MCP tools' },
    ],
  )
})

test('serializes selected MCP entities as explicit, non-path prompt references', async () => {
  const candidates = McpMentionModel.candidates({
    rankedServers: [{ displayName: 'Figma Design', serverName: 'figma', name: 'figma Figma Design' }],
    rankedTools: [{ name: 'mcp__figma__create_frame', description: 'Create a frame' }],
    serverSection: 'MCP servers',
    toolSection: 'MCP tools',
  })
  const selected = candidates[1]
  if (selected === undefined) throw new Error('The MCP tool candidate is missing.')
  const picked = McpMentionModel.pick(selected)
  assert.deepEqual(picked, {
    insert: {
      source: 'mcp-servers',
      ref: '{"kind":"tool","name":"mcp__figma__create_frame"}',
      label: 'mcp__figma__create_frame',
      clipboardText: 'MCP tool: mcp__figma__create_frame',
    },
  })
  if (picked === undefined) return

  assert.equal(
    await McpMentionModel.serialize({
      ref: picked.insert.ref,
      signal: new AbortController().signal,
      serverInstruction: 'The user explicitly referenced MCP server',
      toolInstruction: 'The user explicitly referenced MCP tool',
      useWhenRelevant: 'Use it only when relevant.',
    }),
    'The user explicitly referenced MCP tool "mcp__figma__create_frame". Use it only when relevant.',
  )
  await assert.rejects(
    McpMentionModel.serialize({
      ref: '{invalid',
      signal: new AbortController().signal,
      serverInstruction: 'Server',
      toolInstruction: 'Tool',
      useWhenRelevant: 'Use when relevant.',
    }),
    /MCP autocomplete reference is invalid/u,
  )
})

test('ranks @mcp: queries by their text and stays empty under another scope', () => {
  assert.equal(McpMentionModel.scopedQuery({ query: 'figma', ownScope: 'mcp' }), 'figma')
  assert.equal(McpMentionModel.scopedQuery({ query: 'mcp:figma', ownScope: 'mcp' }), 'figma')
  assert.equal(McpMentionModel.scopedQuery({ query: 'f:src/', ownScope: 'mcp' }), undefined)
  assert.equal(McpMentionModel.scopedQuery({ query: 'skill:review', ownScope: 'mcp' }), undefined)
})

test('reads the @mcp catalog on the first @ query, not when a composer mounts, and reuses it', async () => {
  let reads = 0
  const mentions = createMcpMentionSource({
    rank: items => items,
    list: async () => {
      reads += 1
      return { servers: [], tools: [] }
    },
    serverSection: 'Servers',
    toolSection: 'Tools',
    serverInstruction: '',
    toolInstruction: '',
    useWhenRelevant: '',
  })
  assert.equal('warm' in mentions.source, false)
  assert.equal(reads, 0)

  // SAFETY: the source reads only `sessionId` from the session and `query`, `quoted`, `signal` from the request.
  const session = { sessionId: 'session-a' } as unknown as Parameters<typeof mentions.source.candidates>[0]
  const request = { query: 'mcp:fig', quoted: false, signal: new AbortController().signal } as unknown as Parameters<typeof mentions.source.candidates>[1]
  await mentions.source.candidates(session, request)
  await mentions.source.candidates(session, request)
  assert.equal(reads, 1)
})
