import assert from 'node:assert/strict'
import { SessionId } from '@deepseek-ai/dsh-session'
import { test } from 'vitest'
import { createSkillMentionSource, SkillMentionModel } from './skill-mention.js'

test('maps user-invocable skills to the @ group and marks user-only skills', () => {
  const skills = [
    { name: 'review', description: 'Review code changes', modelInvocable: true },
    { name: 'migrate', description: 'Migrate dependencies', modelInvocable: false },
  ]

  assert.deepEqual(SkillMentionModel.skillMentionCandidates({ skills, section: 'Skills', userOnlyLabel: 'User-only' }), [
    { name: 'review', description: 'Review code changes', section: 'Skills' },
    { name: 'migrate', description: 'User-only · Migrate dependencies', section: 'Skills' },
  ])
})

test('routes a selected skill through the existing slash invocation', () => {
  assert.deepEqual(SkillMentionModel.skillMentionPick({ name: 'migrate' }), { text: '/migrate ' })
  assert.equal(SkillMentionModel.skillMentionPick({ name: 'invalid skill' }), undefined)
})

test('ranks @skill: queries by their text and stays empty under another scope', () => {
  assert.equal(SkillMentionModel.scopedMentionQuery('rev', 'skill'), 'rev')
  assert.equal(SkillMentionModel.scopedMentionQuery('Skill:rev', 'skill'), 'rev')
  assert.equal(SkillMentionModel.scopedMentionQuery('t:rev', 'skill'), undefined)
  assert.equal(SkillMentionModel.scopedMentionQuery('mcp:figma', 'skill'), undefined)
})

test('reads the skill catalog on the first @ query, not when a composer mounts, and reuses it', async () => {
  let reads = 0
  const mentions = createSkillMentionSource({
    isSubagent: () => false,
    list: async () => {
      reads += 1
      return [{ name: 'review', description: 'Review code changes', modelInvocable: true }]
    },
    rank: skills => skills,
    section: 'Skills',
    userOnlyLabel: 'User-only',
  })
  assert.equal('warm' in mentions.source, false)
  assert.equal(reads, 0)

  const session = { sessionId: SessionId('session-a') }
  const request = { query: 'rev', quoted: false, position: 'inline' as const, drilled: false, signal: new AbortController().signal }
  await mentions.source.candidates(session, request)
  await mentions.source.candidates(session, request)
  assert.equal(reads, 1)
})
