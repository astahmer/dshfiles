import assert from 'node:assert/strict'
import { test } from 'vitest'
import { InlineCompletion, type InlineAgent } from './inline-completion.js'

const agents: readonly InlineAgent[] = [
  { handle: 'dsh', name: 'DSH', glyph: '🛠', description: 'The harness itself' },
  { handle: 'reviewer', name: 'Reviewer', glyph: '🔍', description: 'Reads diffs for bugs' },
]

const at = (text: string): ReturnType<typeof InlineCompletion.tokenAt> => InlineCompletion.tokenAt(text, text.length)

test('a plain @ token carries the query and where it starts', () => {
  assert.deepEqual(at('please @rev'), { trigger: '@', query: 'rev', start: 7, scope: null })
  assert.deepEqual(at('@'), { trigger: '@', query: '', start: 0, scope: null })
  assert.equal(InlineCompletion.tokenAt('no token', 8), null)
})

test('a scope prefix is parsed, and its own scope keeps the query after the colon', () => {
  assert.deepEqual(at('@agent:rev'), { trigger: '@', query: 'rev', start: 0, scope: 'agent' })
  assert.deepEqual(at('@b:12'), { trigger: '@', query: '12', start: 0, scope: 'b' })
  assert.equal(at('#tag')?.scope, null)
})

test('agent rows match handle, name or description, and insert the readable mention', () => {
  assert.deepEqual(
    InlineCompletion.agents(at('@rev'), agents).map(row => row.insert),
    ['@reviewer '],
  )
  assert.deepEqual(
    InlineCompletion.agents(at('@diffs'), agents).map(row => row.handle),
    ['reviewer'],
  )
  assert.deepEqual(
    InlineCompletion.agents(at('@'), agents).map(row => row.handle),
    ['dsh', 'reviewer'],
  )
  assert.equal(InlineCompletion.insertFor('reviewer'), '@reviewer ')
})

test('another source’s scope keeps its own meaning, so no agent row appears', () => {
  assert.deepEqual(InlineCompletion.agents(at('@b:12'), agents), [])
  assert.deepEqual(InlineCompletion.agents(at('@t:fix'), agents), [])
  assert.deepEqual(InlineCompletion.agents(at('@f:src'), agents), [])
  assert.deepEqual(
    InlineCompletion.agents(at('@agent:rev'), agents).map(row => row.handle),
    ['reviewer'],
  )
  assert.deepEqual(
    InlineCompletion.agents(at('@a:'), agents).map(row => row.handle),
    ['dsh', 'reviewer'],
  )
})

test('a quoted query is a file path, and a tag never lists agents', () => {
  assert.deepEqual(InlineCompletion.agents(at('@"src/rev'), agents, { quoted: true }), [])
  assert.deepEqual(InlineCompletion.agents(at('#rev'), agents), [])
  assert.deepEqual(InlineCompletion.agents(null, agents), [])
})
