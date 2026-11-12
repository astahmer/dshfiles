import assert from 'node:assert/strict'
import test from 'node:test'
import { matchingHostPids } from './running-hosts.mjs'

const home = '/Users/me/alt-dsh'
const coreEntry = '/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'
const options = { home, profile: 'web', coreEntry, uid: 501 }
const pids = text => matchingHostPids(text, options)

test('every way of starting a Host on this home and profile matches', () => {
  assert.deepEqual(pids(`1 501 node dsh-runtime/node_modules/.bin/dsh web DSH_HOME=${home} PATH=/bin HOME=/Users/me`), [1])
  assert.deepEqual(pids(`2 501 /usr/bin/node ${coreEntry} --profile web --no-open DSH_HOME=${home}/ HOME=/Users/me`), [2])
  assert.deepEqual(pids(`3 501 node /x/@deepseek-ai/dsh/lib/bin.js --profile=web DSH_HOME=${home}`), [3])
  assert.deepEqual(pids(`4 501 dsh --patch extra.yml --profile web DSH_HOME=~/alt-dsh HOME=/Users/me`), [4])
  assert.deepEqual(pids('5 501 dsh web HOME=/Users/me'), [], 'unset DSH_HOME means ~/.dsh, another home')
  assert.deepEqual(matchingHostPids('5 501 dsh web HOME=/Users/me', { ...options, home: '/Users/me/.dsh' }), [5])
})

test('an environment value may contain spaces', () => {
  const spaced = '/Users/me/My Homes/dsh'
  assert.deepEqual(matchingHostPids(`6 501 dsh web DSH_HOME=${spaced} HOME=/Users/me`, { ...options, home: spaced }), [6])
  assert.deepEqual(pids(`6 501 dsh web DSH_HOME=${spaced} HOME=/Users/me`), [])
})

test('a Host whose home cannot be established counts as running', () => {
  assert.deepEqual(pids('7 501 node dsh-runtime/node_modules/.bin/dsh web'), [7])
  assert.deepEqual(pids('8 501 dsh web DSH_HOME=relative/home HOME=/Users/me'), [8])
})

test('other homes, profiles, users, subcommands and non-dsh programs do not match', () => {
  const lines = [
    `10 501 node dsh-runtime/node_modules/.bin/dsh web DSH_HOME=/other HOME=/Users/me`,
    `11 501 node ${coreEntry} --profile probe DSH_HOME=${home}`,
    `12 501 node ${coreEntry} --profile web-2 DSH_HOME=${home}`,
    `13 502 node ${coreEntry} --profile web DSH_HOME=${home}`,
    `14 501 dsh plugin --profile web add x DSH_HOME=${home}`,
    `15 501 node supervise-dsh.mjs DSH_HOME=${home} _=/usr/local/bin/dsh`,
    `16 501 vim notes about dsh web DSH_HOME=${home}`,
    `17 501 node launch-dsh.mjs DSHX_DSH_HOME=${home} DSH_PROFILE=web`,
  ]
  assert.deepEqual(pids(lines.join('\n')), [])
})
