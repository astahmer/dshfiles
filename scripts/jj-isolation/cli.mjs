#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { evaluate, isEnabled, readConfig, rewriteFootprint, workspaceHeads, readJj, DEFAULT_CONFIG } from './guard.mjs'

const USAGE = `jj-isolation — refuse jj operations that would rewrite another live workspace's working copy.

  jj-isolation run   <jj args...>   decide, then exec the real jj (used by the shim)
  jj-isolation check <jj args...>   print the decision as JSON; exit 3 when refused
  jj-isolation recover [--json]     list divergent changes and where their content lives

Detection is opt-in per repository: create .jj/jj-isolation.json, or set JJ_ISOLATION=on.
`

const realJj = () => process.env.JJ_ISOLATION_REAL_JJ ?? 'jj'

const execRealJj = argv => {
  const result = spawnSync(realJj(), argv, {
    stdio: 'inherit',
    env: { ...process.env, JJ_ISOLATION_ACTIVE: '1' },
  })
  if (result.error !== undefined) {
    process.stderr.write(`jj-isolation: could not run ${realJj()}: ${result.error.message}\n`)
    process.exit(127)
  }
  process.exit(result.status ?? (result.signal === null ? 1 : 128))
}

const decide = argv => {
  const cwd = process.cwd()
  if (!isEnabled(cwd)) return { decision: 'allow', reason: 'isolation-disabled' }
  try {
    return evaluate({ cwd, argv })
  } catch (error) {
    return {
      decision: 'refuse',
      code: 'guard-failed',
      reason: `jj-isolation could not read repository state: ${error.message}`,
      detail: 'Refusing rather than running an unguarded rewrite. JJ_ISOLATION=off disables the guard for this repository.',
    }
  }
}

const report = decision => {
  if (decision.decision === 'allow') return
  const label = decision.decision === 'refuse' ? 'refused' : 'rewritten'
  process.stderr.write(`jj-isolation: ${label} [${decision.code}] ${decision.reason}\n`)
  if (decision.detail !== undefined) process.stderr.write(`  ${decision.detail}\n`)
}

const divergentChanges = cwd => {
  const rows = readJj({
    args: ['log', '-r', 'divergent()', '--no-graph', '-T', 'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ description.first_line() ++ "\\n"'],
    cwd,
  })
  const grouped = new Map()
  for (const line of rows.split('\n').filter(Boolean)) {
    const [changeId = '', commitId = '', description = ''] = line.split('\t')
    const copies = grouped.get(changeId) ?? []
    copies.push({ commitId, description })
    grouped.set(changeId, copies)
  }
  return grouped
}

const fileCount = (cwd, commitId) =>
  readJj({ args: ['file', 'list', '-r', commitId, '-T', 'path ++ "\\n"'], cwd }).split('\n').filter(Boolean).length

const recover = (cwd, asJson) => {
  const heads = workspaceHeads(cwd)
  const divergences = [...divergentChanges(cwd)].map(([changeId, copies]) => ({
    changeId,
    copies: copies.map(copy => ({ ...copy, files: fileCount(cwd, copy.commitId) })),
  }))
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ workspaces: heads, divergences }, null, 2)}\n`)
    return divergences.length === 0 ? 0 : 3
  }
  if (divergences.length === 0) {
    process.stdout.write('No divergent changes: every change id resolves to exactly one commit.\n')
    return 0
  }
  process.stdout.write('Divergent changes found. Nothing was modified; inspect and pick a copy per change.\n\n')
  for (const entry of divergences) {
    process.stdout.write(`change ${entry.changeId}\n`)
    for (const copy of entry.copies) {
      process.stdout.write(`  ${copy.commitId}  files=${String(copy.files).padStart(4)}  ${copy.description}\n`)
    }
  }
  process.stdout.write(
    '\nRecover the copy that holds your work without rewriting anything:\n' +
      '  jj new <kept-commit-id>          # inside the owning workspace, move @ onto that copy\n' +
      '  jj abandon <losing-commit-id>    # only after the files are back on disk and verified\n',
  )
  return 3
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'run' || command === 'check') {
  const decision = decide(rest)
  if (command === 'check') {
    process.stdout.write(`${JSON.stringify(decision)}\n`)
    process.exit(decision.decision === 'refuse' ? 3 : 0)
  }
  report(decision)
  if (decision.decision === 'refuse') process.exit(3)
  execRealJj(decision.decision === 'rewrite' ? decision.argv : rest)
} else if (command === 'recover') {
  const cwd = process.cwd()
  readConfig(cwd) ?? DEFAULT_CONFIG
  process.exit(recover(cwd, rest.includes('--json')))
} else if (command === 'footprint') {
  const cwd = process.cwd()
  process.stdout.write(`${[...rewriteFootprint(cwd, rest)].join('\n')}\n`)
} else {
  process.stderr.write(USAGE)
  process.exit(command === undefined || command === '--help' || command === '-h' ? 0 : 2)
}
