#!/usr/bin/env node

/**
 * One-shot Jujutsu state for an agent: workspace, working copy, conflicts,
 * `main` against `main@origin`, and the revisions above `main` — in one process
 * instead of the four to six `jj` calls an agent otherwise runs per status
 * check. Across 2026-10-15..18 the sessions logged 10k+ `jj` invocations, most
 * of them one-line status/log reads.
 *
 *   node scripts/jj-state.mjs [--repo <path>] [--read-only]
 *
 * `--read-only` adds `--ignore-working-copy`, so it never snapshots the
 * working copy: use it for another agent's workspace, never the bare form.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const readOnly = argv.includes('--read-only')
const repoFlag = argv.indexOf('--repo')
const repo = resolve(repoFlag === -1 ? process.cwd() : (argv[repoFlag + 1] ?? process.cwd()))
const maxLines = 12

const logTemplate = 'change_id.short() ++ " " ++ commit_id.short() ++ " " ++ if(description, description.first_line(), "(no description)")'

const jj = args => {
  const run = spawnSync(process.env.JJ ?? 'jj', [...args, '--color=never'], { cwd: repo, encoding: 'utf8' })
  if (run.error !== undefined) return { ok: false, out: '', err: `jj unavailable: ${run.error.message}` }
  return { ok: run.status === 0, out: (run.stdout ?? '').trim(), err: (run.stderr ?? '').trim() }
}

const guard = args => (readOnly ? ['--ignore-working-copy', ...args] : args)

const section = (title, body) => {
  console.log(`\n== ${title} ==`)
  console.log(body === '' ? '(none)' : body)
}

const capped = text => {
  const lines = text.split('\n').filter(line => line !== '')
  if (lines.length <= maxLines) return lines.join('\n')
  return [...lines.slice(0, maxLines), `… ${String(lines.length - maxLines)} more`].join('\n')
}

const log = revset => jj(guard(['log', '-r', revset, '--no-graph', '-T', `${logTemplate} ++ "\\n"`]))

console.log(`jj-state ${readOnly ? '(read-only) ' : ''}${repo}`)

const current = jj(guard(['log', '-r', '@', '--no-graph', '-T', `${logTemplate} ++ "\\n"`]))
section('@ (this workspace)', current.ok ? capped(current.out) : current.err)

if (!readOnly) {
  const status = jj(['status'])
  section('status (working copy)', status.ok ? capped(status.out) : status.err)
}

const conflicts = jj(guard(['log', '-r', 'conflicts()', '--no-graph', '-T', `${logTemplate} ++ "\\n"`]))
section('conflicts', conflicts.ok ? capped(conflicts.out) : conflicts.err)

const heads = log('main | main@origin')
section('main | main@origin', heads.ok ? capped(heads.out) : heads.err)

const aboveMain = log('main..@')
section('main..@ (this workspace, newest first)', aboveMain.ok ? capped(aboveMain.out) : aboveMain.err)

const undescribed = jj(guard(['log', '-r', 'main..@ & description(exact:"")', '--no-graph', '-T', '"x\\n"']))
section(
  'undescribed above main',
  undescribed.ok
    ? undescribed.out === ''
      ? 'none (every revision above main is described)'
      : `${String(undescribed.out.split('\n').length)} revision(s) need a description`
    : undescribed.err,
)
