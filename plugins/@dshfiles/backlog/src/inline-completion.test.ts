import assert from 'node:assert/strict'
import { test } from 'vitest'
import { InlineCompletion, type InlineAgent } from './inline-completion.js'

const agents: readonly InlineAgent[] = [
  { handle: 'dsh', name: 'DSH', glyph: '🛠', description: 'The harness itself' },
  { handle: 'reviewer', name: 'Reviewer', glyph: '🔍', description: 'Reads diffs for bugs' },
]

const at = (text: string): ReturnType<typeof InlineCompletion.tokenAt> => InlineCompletion.tokenAt(text, text.length)

test('a plain @ token carries the query and its whole range', () => {
  assert.deepEqual(at('please @rev'), { trigger: '@', query: 'rev', start: 7, end: 11, scope: null })
  assert.deepEqual(at('@'), { trigger: '@', query: '', start: 0, end: 1, scope: null })
  assert.equal(InlineCompletion.tokenAt('no token', 8), null)
  assert.deepEqual(InlineCompletion.tokenAt('@review later', 3), { trigger: '@', query: 'review', start: 0, end: 7, scope: null })
})

test('a token ends at whitespace, as in the rich composer', () => {
  assert.equal(at('please @add new'), null)
  assert.equal(at('@dsh trying to select it'), null)
  assert.equal(at('@thread:fix project picker'), null)
  assert.equal(at('please #add new'), null)
  assert.deepEqual(at('@thread:fix'), { trigger: '@', query: 'fix', start: 0, end: 11, scope: 'thread' })
  assert.deepEqual(at('@dsh #ta'), { trigger: '#', query: 'ta', start: 5, end: 8, scope: null })
})

test('a pick replaces the whole token and leaves one separator after it', () => {
  const token = (text: string, caret: number) => {
    const found = InlineCompletion.tokenAt(text, caret)
    assert.ok(found)
    return found
  }
  assert.deepEqual(InlineCompletion.applyPick({ text: 'ask @rev', token: token('ask @rev', 8), insert: '@reviewer ' }), { text: 'ask @reviewer ', caret: 14 })
  assert.deepEqual(InlineCompletion.applyPick({ text: '@revi now', token: token('@revi now', 3), insert: '@reviewer ' }), { text: '@reviewer  now', caret: 10 })
  assert.deepEqual(InlineCompletion.applyPick({ text: '@rev\nnext', token: token('@rev\nnext', 4), insert: '@reviewer ' }), {
    text: '@reviewer \nnext',
    caret: 10,
  })
})

test('a scope prefix is parsed, and its own scope keeps the query after the colon', () => {
  assert.deepEqual(at('@agent:rev'), { trigger: '@', query: 'rev', start: 0, end: 10, scope: 'agent' })
  assert.deepEqual(at('@b:12'), { trigger: '@', query: '12', start: 0, end: 5, scope: 'b' })
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

test('project completions show readable draft tokens', () => {
  assert.deepEqual(InlineCompletion.projects(at('@dsh'), ['/work/dshfiles', '/work/other']), [{ path: '/work/dshfiles', insert: '@project:dshfiles ' }])
  assert.deepEqual(InlineCompletion.projects(at('@'), ['/work/dshfiles', '/work/space name', '/work/project[one]']), [
    { path: '/work/dshfiles', insert: '@project:dshfiles ' },
    { path: '/work/space name', insert: '@project:space-name ' },
    { path: '/work/project[one]', insert: '@project:project[one] ' },
  ])
  assert.deepEqual(InlineCompletion.projects(at('@'), ['/work/alpha/shared', '/work/beta/shared']), [
    { path: '/work/alpha/shared', insert: '@project:alpha-shared ' },
    { path: '/work/beta/shared', insert: '@project:beta-shared ' },
  ])
  assert.deepEqual(InlineCompletion.projects(at('@b:12'), ['/work/dshfiles']), [])
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
