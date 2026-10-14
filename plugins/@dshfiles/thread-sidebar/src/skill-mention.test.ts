import assert from 'node:assert/strict'
import { test } from 'vitest'
import { scopedMentionQuery, skillMentionCandidates, skillMentionPick } from './skill-mention.js'

test('maps user-invocable skills to the @ group and marks user-only skills', () => {
  const skills = [
    { name: 'review', description: 'Review code changes', modelInvocable: true },
    { name: 'migrate', description: 'Migrate dependencies', modelInvocable: false },
  ]

  assert.deepEqual(skillMentionCandidates({ skills, section: 'Skills', userOnlyLabel: 'User-only' }), [
    { name: 'review', description: 'Review code changes', section: 'Skills' },
    { name: 'migrate', description: 'User-only · Migrate dependencies', section: 'Skills' },
  ])
})

test('routes a selected skill through the existing slash invocation', () => {
  assert.deepEqual(skillMentionPick({ name: 'migrate' }), { text: '/migrate ' })
  assert.equal(skillMentionPick({ name: 'invalid skill' }), undefined)
})

test('ranks @skill: queries by their text and stays empty under another scope', () => {
  assert.equal(scopedMentionQuery('rev', 'skill'), 'rev')
  assert.equal(scopedMentionQuery('Skill:rev', 'skill'), 'rev')
  assert.equal(scopedMentionQuery('t:rev', 'skill'), undefined)
  assert.equal(scopedMentionQuery('mcp:figma', 'skill'), undefined)
})
