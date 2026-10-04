import { classifyBashCommand } from '/Users/astahmer/dev/dshfiles/plugins/@dshfiles/bash-parallel/src/classify.ts'

// The one survivor: a backtick appears inside a single-quoted grep pattern.
// A backtick inside single quotes is a literal, not a command substitution.
const cases = [
  {
    label: 'backtick inside single quotes',
    command: "cd ~/dev/dshfiles && grep -rnoE '`[^`]*\\.(md|json|yml)`' AGENTS.md",
  },
  {
    label: 'backtick inside double quotes',
    command: 'echo "the `backtick` is literal"',
  },
  {
    label: 'backtick genuinely executing',
    command: 'echo `ls`',
  },
  {
    label: 'command substitution genuinely executing',
    command: 'echo $(ls)',
  },
  {
    label: 'single-quoted dollar-paren is literal',
    command: "grep -f '$(literal).txt' list",
  },
]

for (const { label, command } of cases) {
  const verdict = classifyBashCommand(command)
  console.log(`${verdict.parallel ? 'PARALLEL ' : 'EXCLUSIVE'}  ${label}`)
  console.log(`          ${verdict.reason}`)
}