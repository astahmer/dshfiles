#!/usr/bin/env node
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluate, parseArgv, parseWorkspaceHeads, rewriteTargets } from './guard.mjs'

test('parseArgv skips global flags and their values', () => {
  assert.deepEqual(parseArgv(['--color=never', '--no-pager', 'describe', '-m', 'x']), { subcommand: 'describe', rest: ['-m', 'x'] })
  assert.deepEqual(parseArgv(['-R', '/tmp/repo', 'log', '-r', '@']), { subcommand: 'log', rest: ['-r', '@'] })
  assert.deepEqual(parseArgv(['workspace', 'add', '/tmp/ws', '--name', 'ws']), { subcommand: 'workspace add', rest: ['/tmp/ws', '--name', 'ws'] })
  assert.deepEqual(parseArgv(['workspace']), { subcommand: 'workspace', rest: [] })
})

test('rewriteTargets names only the revisions a command rewrites', () => {
  assert.deepEqual(rewriteTargets(['describe', '-m', 'message with describe inside']), ['@'])
  assert.deepEqual(rewriteTargets(['describe', 'abc123', '-m', 'msg']), ['abc123'])
  assert.deepEqual(rewriteTargets(['abandon', 'a', 'b']), ['a', 'b'])
  assert.deepEqual(rewriteTargets(['split', '-r', 'abc']), ['abc'])
  assert.deepEqual(rewriteTargets(['squash', '--from', 'a', '--into', 'b']), ['a', 'b'])
  assert.deepEqual(rewriteTargets(['squash']), ['@'])
  assert.deepEqual(rewriteTargets(['rebase', '-s', 'a', '-d', 'b']), ['a'])
  assert.deepEqual(rewriteTargets(['restore', '--changes-in', 'abc']), ['abc'])
  assert.deepEqual(rewriteTargets(['restore', '--into', 'abc']), ['abc'])
  assert.deepEqual(rewriteTargets(['duplicate', 'abc']), [])
  assert.deepEqual(rewriteTargets(['log', '-r', '@']), [])
  assert.deepEqual(rewriteTargets(['commit', '-m', 'x']), [])
})

test('parseWorkspaceHeads reads the jj workspace template output', () => {
  assert.deepEqual(parseWorkspaceHeads('default\taaa\nws1\tbbb\n\n'), [
    { name: 'default', commit: 'aaa' },
    { name: 'ws1', commit: 'bbb' },
  ])
})

test('a non-mutating subcommand is always allowed', () => {
  const allowed = evaluate({ cwd: process.cwd(), argv: ['log', '-r', '@'] })
  assert.equal(allowed.decision, 'allow')
  assert.equal(allowed.reason, 'not-a-mutating-subcommand')
})

test('repo-wide operations are refused before any jj state is read', () => {
  const refused = evaluate({ cwd: process.cwd(), argv: ['op', 'restore', 'abc'] })
  assert.equal(refused.decision, 'refuse')
  assert.equal(refused.code, 'repo-wide-refused')
})
