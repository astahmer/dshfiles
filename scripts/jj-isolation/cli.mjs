#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { evaluate, headFingerprint, isEnabled, maintenancePath, readMaintenance, readJj, rewriteFootprint, workspaceHeads } from './guard.mjs'
import { applyMigration, planMigration } from './migrate.mjs'
import { buildPreflight, formatPreflight } from './preflight.mjs'

const USAGE = `jj-isolation — refuse jj operations that would rewrite another live workspace's working copy.

  jj-isolation run   <jj args...>   decide, then exec the real jj (used by the shim)
  jj-isolation check <jj args...>   print the decision as JSON; exit 3 when refused
  jj-isolation recover [--json]     list divergent changes and where their content lives
  jj-isolation preflight [--json]   read-only repository report and migration plan
  jj-isolation maintenance arm|disarm|status [--ack-running-jj]
                                    fence the store while migrating workspaces
  jj-isolation migrate <name> --base <revset> [--mode auto|leaf-from-current|reset-to-base]
                                    [--apply] [--accept-graft] [--force]
                                    move one workspace's @ onto its own leaf

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

const flagValueOf = (argv, name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

const armMaintenance = (cwd, argv) => {
  const quietSeconds = Number(flagValueOf(argv, '--quiet-seconds', '120'))
  const ttlMinutes = Number(flagValueOf(argv, '--ttl-minutes', '30'))
  const armedBy = flagValueOf(argv, '--armed-by', process.env.USER ?? 'operator')
  const reason = flagValueOf(argv, '--reason', 'workspace isolation migration')
  const preflight = buildPreflight({ cwd, quietSeconds })
  if (!preflight.safety.quiet) {
    const newest = preflight.safety.newestOperation
    throw new Error(
      `repository is not quiet: ${preflight.safety.recentOperationCount} operation(s) in the last ${quietSeconds}s` +
        `${newest === undefined ? '' : ` (newest "${newest.description}" ${newest.ageSeconds}s ago)`}. Wait for agents to stop, then re-arm.`,
    )
  }
  if (preflight.safety.mutatingJjProcesses.length > 0) {
    if (!argv.includes('--ack-running-jj')) {
      throw new Error(
        `a mutating jj command is in flight somewhere on this machine; wait for it before arming maintenance mode, or pass --ack-running-jj once you have confirmed none of them targets this store:\n  ${preflight.safety.mutatingJjProcesses.join('\n  ')}`,
      )
    }
    process.stderr.write(
      `jj-isolation: --ack-running-jj accepted with ${preflight.safety.mutatingJjProcesses.length} mutating jj command(s) in flight; the fence cannot tell which store they target.\n`,
    )
  }
  if (preflight.safety.runningJjProcesses.length > 0) {
    process.stderr.write(
      `jj-isolation: note: ${preflight.safety.runningJjProcesses.length} long-running jj process(es) exist (e.g. a branching server). They are not fenced by the guard; confirm they are idle.\n`,
    )
  }
  const gate = {
    version: 1,
    token: randomUUID(),
    armedBy,
    reason,
    armedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMinutes * 60_000,
    ...headFingerprint(cwd),
  }
  writeFileSync(maintenancePath(cwd), `${JSON.stringify(gate, null, 2)}\n`, { mode: 0o600 })
  return gate
}

const disarmMaintenance = (cwd, argv) => {
  const path = maintenancePath(cwd)
  const gate = readMaintenance(cwd)
  if (gate === undefined) return { removed: false, path }
  const token = flagValueOf(argv, '--token', process.env.JJ_ISOLATION_MAINTENANCE_TOKEN ?? '')
  if (token !== gate.token && !argv.includes('--force')) {
    throw new Error(`refusing to disarm: pass --token <token> or --force (gate ${gate.token})`)
  }
  unlinkSync(path)
  return { removed: true, path }
}

const migrateCommand = (cwd, argv) => {
  const name = argv.find(argument => !argument.startsWith('-'))
  if (name === undefined) throw new Error('usage: jj-isolation migrate <workspace-name> --base <revset> [--apply] [--force]')
  const base = flagValueOf(argv, '--base', 'integration-spine')
  const mode = flagValueOf(argv, '--mode', 'auto')
  if (!['auto', 'leaf-from-current', 'reset-to-base'].includes(mode)) throw new Error(`--mode must be auto, leaf-from-current or reset-to-base (got ${mode})`)
  const plan = planMigration({ repoRoot: cwd, name, base, mode, force: argv.includes('--force'), acceptGraft: argv.includes('--accept-graft') })
  if (!argv.includes('--apply')) return { planned: true, plan }
  const gate = readMaintenance(cwd)
  if (gate === undefined || gate.expired) throw new Error('maintenance mode is not armed (or has expired): run `jj-isolation maintenance arm` first')
  const applied = applyMigration({ repoRoot: cwd, name, plan, gate, onEvent: message => process.stderr.write(`  ${message}\n`) })
  // The fence recorded the pre-migration heads and operation id, so re-arm it for
  // the next workspace instead of failing the start check on our own change.
  writeFileSync(maintenancePath(cwd), `${JSON.stringify({ ...gate, ...headFingerprint(cwd) }, null, 2)}\n`, { mode: 0o600 })
  return { planned: false, plan, applied }
}

const formatMaintenance = gate =>
  gate === undefined
    ? 'maintenance: disarmed'
    : [
        `maintenance: ${gate.expired ? 'EXPIRED' : 'ARMED'} by ${gate.armedBy ?? '?'} at ${gate.armedAt ?? '?'}`,
        `  token    ${gate.token}`,
        `  reason   ${gate.reason ?? '(none)'}`,
        `  fence    op ${String(gate.opId ?? '').slice(0, 12)} over ${Object.keys(gate.heads ?? {}).length} workspace(s)`,
        `  expires  ${gate.expiresAt === undefined ? 'never' : new Date(gate.expiresAt).toISOString()}`,
      ].join('\n')

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
  process.exit(recover(process.cwd(), rest.includes('--json')))
} else if (command === 'preflight') {
  const cwd = process.cwd()
  const preflight = buildPreflight({ cwd, quietSeconds: Number(flagValueOf(rest, '--quiet-seconds', '120')) })
  process.stdout.write(rest.includes('--json') ? `${JSON.stringify(preflight, null, 2)}\n` : `${formatPreflight(preflight)}\n`)
  process.exit(preflight.safety.quiet ? 0 : 3)
} else if (command === 'migrate') {
  try {
    const result = migrateCommand(process.cwd(), rest)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exit(result.planned ? 0 : 0)
  } catch (error) {
    process.stderr.write(`jj-isolation: ${error.message}\n`)
    process.exit(3)
  }
} else if (command === 'maintenance') {
  const action = rest[0]
  const asJson = rest.includes('--json')
  try {
    if (action === 'arm') {
      const gate = armMaintenance(process.cwd(), rest)
      process.stdout.write(asJson ? `${JSON.stringify(gate, null, 2)}\n` : `${formatMaintenance(gate)}\n`)
    } else if (action === 'disarm') {
      const result = disarmMaintenance(process.cwd(), rest)
      process.stdout.write(asJson ? `${JSON.stringify(result, null, 2)}\n` : `${result.removed ? `disarmed (${result.path})` : 'maintenance was not armed'}\n`)
    } else {
      const gate = readMaintenance(process.cwd())
      process.stdout.write(asJson ? `${JSON.stringify(gate ?? null, null, 2)}\n` : `${formatMaintenance(gate)}\n`)
    }
  } catch (error) {
    process.stderr.write(`jj-isolation: ${error.message}\n`)
    process.exit(3)
  }
} else if (command === 'footprint') {
  process.stdout.write(`${[...rewriteFootprint(process.cwd(), rest)].join('\n')}\n`)
} else {
  process.stderr.write(USAGE)
  process.exit(command === undefined || command === '--help' || command === '-h' ? 0 : 2)
}
