import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyBashCommand } from './classify.ts'

const parallel = (command: string): void => {
  const verdict = classifyBashCommand(command)
  assert.equal(verdict.parallel, true, `expected parallel: ${command} (${verdict.reason})`)
}

const exclusive = (command: string): void => {
  const verdict = classifyBashCommand(command)
  assert.equal(verdict.parallel, false, `expected exclusive: ${command}`)
}

test('plain reads are parallel', () => {
  for (const command of [
    'ls',
    'ls -la /tmp',
    'cat package.json',
    'cat a.ts b.ts',
    'jj --ignore-working-copy status',
    'git status',
    'git diff',
    'ast-outline --format=compact src/index.ts',
    'node --version',
    'pwd && git status',
    'ls; echo ---; ls',
    'cat a.ts | head -20',
    'wc -l *.ts',
    'stat . && df -h',
  ])
    parallel(command)
})

test('bare jj reads are exclusive because they snapshot the working copy', () => {
  for (const command of ['jj status', 'jj log', 'jj diff', 'jj file show -r @ a.ts']) {
    exclusive(command)
  }
  parallel('jj --ignore-working-copy status')
  parallel('jj --ignore-working-copy diff')
})

test('writes are exclusive', () => {
  for (const command of [
    'rm file',
    'mv a b',
    'cp a b',
    'mkdir x',
    'touch x',
    'jj describe -m msg',
    'jj commit -m msg',
    'git add .',
    'git commit -m x',
    'npm install',
    'echo x > file',
    'echo x >> file',
    'cat x | tee y',
    'dd if=/dev/zero of=f',
  ])
    exclusive(command)
})

test('read verb with a write flag is exclusive', () => {
  for (const command of [
    'find . -name "*.ts" -delete',
    'find . -name "*.ts" -exec rm {} ;',
    'find . -newer f -fprint out',
    'sed -i s/a/b/ file',
    "sed -i'' s/a/b/ file",
  ])
    exclusive(command)
})

test('subcommand allowlists gate git and jj', () => {
  parallel('git log --oneline')
  parallel('git show abc123')
  parallel('git ls-files')
  exclusive('git checkout main')
  exclusive('git reset --hard')
  exclusive('git stash')
  exclusive('jj new')
  exclusive('jj restore .')
})

test('jj needs the read-only flag', () => {
  exclusive('jj diff')
  parallel('jj --ignore-working-copy diff')
  parallel('jj --ignore-working-copy log')
})

test('hidden writes are exclusive', () => {
  for (const command of ['echo $(rm -rf /)', 'cat `whoami`', 'cat x | sh', 'bash -c "rm x"', 'sh -c "ls"', 'eval "ls"', 'source ./env.sh', '. ./env.sh'])
    exclusive(command)
})

test('malformed input fails closed', () => {
  for (const command of ['', '   ', ';', '&&', 'ls |', '| ls', '$(ls)', '`ls`', 'ls &', 'ls && sleep 10 &']) exclusive(command)
})

test('background execution is exclusive', () => {
  exclusive('sleep 5 &')
  exclusive('ls &')
  exclusive('ls; sleep 5 &')
})

test('reads piped into a writer are exclusive', () => {
  exclusive('ls | tee out.txt')
  exclusive('cat a | dd of=/dev/sda')
})

test('subshells and grouping are exclusive', () => {
  exclusive('(ls; rm x)')
  exclusive('{ ls; rm x; }')
  exclusive('(ls)')
})

test('reasons are populated for exclusive verdicts', () => {
  const verdict = classifyBashCommand('rm x')
  assert.equal(verdict.parallel, false)
  assert.ok(verdict.reason.length > 0)
})
