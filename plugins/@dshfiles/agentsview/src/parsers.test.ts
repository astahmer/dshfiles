import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { AgentLogs, type AgentReader } from './parsers.js'

const fixture = (relative: string): readonly string[] =>
  readFileSync(fileURLToPath(new URL(`../fixtures/home/${relative}`, import.meta.url)), 'utf8')
    .split('\n')
    .filter(line => line.length > 0)

const claudeCodeParser = AgentLogs.forAgent('claude-code')
const codexParser = AgentLogs.forAgent('codex')
const line = (record: Schema.Json): string => JSON.stringify(record)

const CLAUDE = fixture('.claude/projects/-fixture-agentsview-claude/11111111-1111-4111-8111-111111111111.jsonl')
const CODEX = fixture('.codex/sessions/2026/10/30/rollout-2026-10-30T10-00-00-22222222-2222-4222-8222-222222222222.jsonl')

const summarize = (parser: AgentReader, lines: readonly string[]) => {
  const state = AgentLogs.emptySummary()
  for (const text of lines) parser.summarizeLine(state, text)
  return state
}
const itemsOf = (parser: AgentReader, lines: readonly string[]) => lines.flatMap(text => parser.itemsOfLine(text) ?? [])

describe('Claude Code parser', () => {
  it('summarizes a Claude Code log, counting a streamed message once and skipping meta prompts', () => {
    const state = summarize(claudeCodeParser, CLAUDE)
    expect(state).toMatchObject({
      title: 'Rename flamingo helper',
      firstPrompt: 'Rename the flamingo helper to pelican',
      cwd: '/fixture/agentsview/claude',
      gitBranch: 'feature/fixture',
      models: ['claude-fixture-4'],
      agentVersion: '2.1.0',
      userMessages: 1,
      assistantMessages: 2,
      toolCalls: 1,
      tokens: { input: 15, output: 35, cacheRead: 640, cacheWrite: 40 },
      startedAt: Date.parse('2026-10-30T09:00:00.000Z'),
      updatedAt: Date.parse('2026-10-30T09:00:09.000Z'),
    })
  })

  it('turns Claude Code content blocks into transcript items', () => {
    const items = itemsOf(claudeCodeParser, CLAUDE)
    expect(items.map(entry => entry.kind)).toEqual(['meta', 'user', 'thinking', 'tool-call', 'tool-result', 'assistant'])
    expect(items[3]).toMatchObject({ toolName: 'Grep', text: '{"pattern":"flamingo"}' })
    expect(items[4]).toMatchObject({ isError: false, text: 'src/flamingo.ts:1: export const flamingo = 1' })
  })

  it('treats a prompt that opens with an injected tag as context, not as the user speaking', () => {
    const user = (content: string) => line({ type: 'user', timestamp: '2026-10-30T09:00:00.000Z', message: { role: 'user', content } })
    expect(claudeCodeParser.itemsOfLine(user('<system-reminder>be brief</system-reminder>'))?.[0]?.kind).toBe('meta')
    expect(claudeCodeParser.itemsOfLine(user('<3 this fix, ship it'))?.[0]?.kind).toBe('user')
    expect(claudeCodeParser.itemsOfLine(user('Fix <Button> spacing'))?.[0]?.kind).toBe('user')
  })

  it('keeps the session id from the file name', () => {
    expect(claudeCodeParser.sessionIdOf('11111111-1111-4111-8111-111111111111.jsonl')).toBe('11111111-1111-4111-8111-111111111111')
  })
})

describe('Codex parser', () => {
  it('summarizes a Codex rollout, taking the last cumulative token count and leaving context messages out', () => {
    const state = summarize(codexParser, CODEX)
    expect(state).toMatchObject({
      title: null,
      firstPrompt: 'Count the walrus tests',
      cwd: '/fixture/agentsview/codex',
      gitBranch: 'main',
      models: ['gpt-fixture-5'],
      agentVersion: '0.200.0',
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 1,
      tokens: { input: 300, output: 80, cacheRead: 1200, cacheWrite: 0 },
    })
    expect(AgentLogs.displayTitle(state, 'id')).toBe('Count the walrus tests')
  })

  it('turns Codex response items into transcript items', () => {
    const items = itemsOf(codexParser, CODEX)
    expect(items.map(entry => entry.kind)).toEqual(['meta', 'meta', 'user', 'thinking', 'tool-call', 'tool-result', 'assistant'])
    expect(items[4]).toMatchObject({ toolName: 'shell' })
    expect(items[5]?.text).toBe('tests/walrus.test.ts:3')
  })

  it('reads the session id from the rollout file name', () => {
    expect(codexParser.sessionIdOf('rollout-2026-10-30T10-00-00-22222222-2222-4222-8222-222222222222.jsonl')).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('ignores records it does not know and truncates oversized text', () => {
    expect(codexParser.itemsOfLine(line({ type: 'compacted', payload: {} }))).toBeNull()
    expect(codexParser.itemsOfLine('not json')).toBeNull()
    const long = codexParser.itemsOfLine(
      line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(10_000) }] } }),
    )
    expect(long?.[0]?.truncated).toBe(true)
    expect(long?.[0]?.text.length).toBe(4_000)
  })
})
