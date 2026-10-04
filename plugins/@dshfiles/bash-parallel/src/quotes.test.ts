import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyBashCommand } from './classify.ts'

const expectVerdict = (command: string, parallel: boolean, label: string): void => {
  const verdict = classifyBashCommand(command)
  assert.equal(verdict.parallel, parallel, `${label}: ${command} -> ${verdict.reason}`)
}

test('quoting suppresses substitution syntax', () => {
  expectVerdict("grep -rnoE '`[^`]*\\.(md|json)`' AGENTS.md", true, 'backtick in single quotes is literal')
  expectVerdict("grep -f '$(literal).txt' list", true, 'dollar-paren in single quotes is literal')
})

test('substitution outside quotes still disqualifies', () => {
  expectVerdict('echo `ls`', false, 'bare backtick executes')
  expectVerdict('echo $(ls)', false, 'bare dollar-paren executes')
  expectVerdict("echo \"x $(ls)\"", false, 'dollar-paren inside double quotes executes')
  expectVerdict("echo \"x `ls`\"", false, 'backtick inside double quotes executes')
})

test('fd duplication is not a file write', () => {
  expectVerdict('ls 2>&1', true, 'merge stderr to stdout')
  expectVerdict('ls >&2', true, 'redirect stdout to stderr')
  expectVerdict('cat < file', true, 'read redirect')
  expectVerdict('ls > /dev/null', true, 'discard to /dev/null')
})

test('file-writing redirects are exclusive', () => {
  expectVerdict('echo x > out.txt', false, 'truncate redirect')
  expectVerdict('echo x >> out.txt', false, 'append redirect')
  expectVerdict('echo x 2> err.txt', false, 'stderr file redirect')
  expectVerdict('echo x <> out.txt', false, 'read-write redirect')
  expectVerdict('cat <(ls)', false, 'process substitution')
  expectVerdict('cat <<EOF', false, 'here-doc')
  expectVerdict('cat <<< word', false, 'here-string')
})

test('the same short flag means different things per verb', () => {
  expectVerdict('grep -a pattern file', true, 'grep -a is --text')
  expectVerdict('find . -maxdepth 2', true, 'find -maxdepth reads')
  expectVerdict('find . -delete', false, 'find -delete writes')
  expectVerdict('sed -n 1,5p file', true, 'sed -n prints without editing')
  expectVerdict('sed -i s/a/b/ file', false, 'sed -i edits in place')
  expectVerdict('sort -k2 file', true, 'sort -k sorts to stdout')
  expectVerdict('sort -o out.txt file', false, 'sort -o writes a file')
})

test('cd is safe because each parallel command gets its own shell', () => {
  expectVerdict('cd /tmp && ls', true, 'cd is process-local')
  expectVerdict('cd a && cd b && pwd', true, 'repeated cd is still local')
})