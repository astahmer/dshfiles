import assert from 'node:assert/strict'
import { test } from 'vitest'
import { decodeMcpMentionTools, mcpMentionCandidates, mcpMentionPick, serializeMcpMention } from './mcp-mentions.js'

test('decodes MCP tools without letting unrelated long descriptions hide them', () => {
  assert.deepEqual(
    decodeMcpMentionTools({
      tools: [
        { name: 'mcp__figma__create_frame', description: 'Create a frame', source: 'mcp' },
        { name: 'workspace.read', description: 'Read a file', source: 'tool' },
        { name: 'long.api', description: 'a'.repeat(1_500), source: 'api' },
      ],
      apis: [],
    }),
    [{ name: 'mcp__figma__create_frame', description: 'Create a frame' }],
  )
  assert.equal(decodeMcpMentionTools({ tools: [{ name: 'mcp__long', description: 'a'.repeat(1_500), source: 'mcp' }] })[0]?.description.length, 1_024)
  assert.deepEqual(decodeMcpMentionTools({ tools: [{ name: 'bad', description: 1, source: 'mcp' }] }), [])
})

test('maps ranked MCP servers and tools into distinct @ sections', () => {
  const candidates = mcpMentionCandidates({
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
  const candidates = mcpMentionCandidates({
    rankedServers: [{ displayName: 'Figma Design', serverName: 'figma', name: 'figma Figma Design' }],
    rankedTools: [{ name: 'mcp__figma__create_frame', description: 'Create a frame' }],
    serverSection: 'MCP servers',
    toolSection: 'MCP tools',
  })
  const selected = candidates[1]
  if (selected === undefined) throw new Error('The MCP tool candidate is missing.')
  const picked = mcpMentionPick(selected)
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
    await serializeMcpMention({
      ref: picked.insert.ref,
      signal: new AbortController().signal,
      serverInstruction: 'The user explicitly referenced MCP server',
      toolInstruction: 'The user explicitly referenced MCP tool',
      useWhenRelevant: 'Use it only when relevant.',
    }),
    'The user explicitly referenced MCP tool "mcp__figma__create_frame". Use it only when relevant.',
  )
  await assert.rejects(
    serializeMcpMention({
      ref: '{invalid',
      signal: new AbortController().signal,
      serverInstruction: 'Server',
      toolInstruction: 'Tool',
      useWhenRelevant: 'Use when relevant.',
    }),
    /MCP autocomplete reference is invalid/u,
  )
})
