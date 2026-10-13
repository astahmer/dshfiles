#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const lintRoots = ['plugins', 'tooling/dshx/packages']

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const run = (command, args) => {
  const { status } = spawnSync(command, args, { stdio: 'inherit' })
  if (status !== 0) process.exit(status ?? 1)
}

const from = flag('--from', '@-')
const to = flag('--to', '@')

const changed = execFileSync('jj', ['diff', '--from', from, '--to', to, '--name-only'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)

const targets = changed.filter(path => lintRoots.some(root => path === root || path.startsWith(`${root}/`)) && existsSync(path))

if (targets.length === 0) {
  console.log(`check:diff: no changed lintable paths in ${from}..${to}`)
  process.exit(0)
}

console.log(`check:diff: ${from}..${to} touches ${targets.length} lintable path(s)`)
run('oxlint', [...targets, '--config', '.oxlintrc.json'])
run('oxfmt', ['--check', ...targets, '--config', '.oxfmtrc.json'])
console.log('check:diff: clean')
