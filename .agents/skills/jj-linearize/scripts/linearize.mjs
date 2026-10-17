#!/usr/bin/env node
/**
 * Deterministic helper for collapsing many jj workspace heads into one line.
 *
 * Every subcommand is read-only except `rebase`, `resolve`, `empty`, `take-main`,
 * `preserve` and `prune --apply`. State (lanes, plan, running tip, resolutions)
 * lives in the state dir, never in the repository.
 *
 * usage: linearize.mjs <command> [options]
 *   snapshot                        print the op id to restore to + graph shape
 *   inventory [--force]             dump every off-bookmark revision and lane
 *   plan                            write the ordered lane plan + lane-list + tip
 *   rebase <lane> [--auto-empty]    rebase one lane onto the running tip
 *   empty <change...>               empty commits (take the parent's content)
 *   take-main <change...>           take the destination side of each conflict
 *   preserve <lane> <name>          duplicate a lane you keep aside + bookmark it
 *   skip <lane> --reason <text>     record a lane you are not integrating
 *   prune [--apply]                 abandon content-free empty revisions
 *   verify                          shape assertions + workspace accounting
 *   report                          write REPORT.md from the recorded state
 *
 * options: --repo <path> --state <dir> --base <revset> --bookmark <name>
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? fallback : argv[at + 1]
}
const has = name => argv.includes(`--${name}`)
const positional = argv.slice(1).filter((value, at) => value !== undefined && !value.startsWith('--') && !(argv[at] ?? '').startsWith('--'))
const repo = resolve(flag('repo', process.cwd()))
const bookmark = flag('bookmark', 'main')
const base = flag('base', `${bookmark}@origin`)
const stateDir = resolve(flag('state', join(tmpdir(), 'jj-linearize', basename(repo))))
mkdirSync(stateDir, { recursive: true })

const maxBuffer = 512 * 1024 * 1024
const jj = (...args) => execFileSync('jj', args, { cwd: repo, encoding: 'utf8', maxBuffer })
const jjTry = (...args) => {
  try {
    return { out: execFileSync('jj', args, { cwd: repo, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] }), ok: true }
  } catch (error) {
    return { out: `${error.stdout ?? ''}${error.stderr ?? ''}`, ok: false }
  }
}
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`)
const loadJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined)
const T = fields => `${fields.join(' ++ "\\t" ++ ')} ++ "\\n"`
const short = 'change_id.shortest(8)'

const revisionRows = revset => {
  const template = `${T([short, 'commit_id', 'parents.map(|p| p.change_id().shortest(8)).join(",")', 'if(empty, "E", "C")', 'author.timestamp()', 'bookmarks', 'description.first_line()'])}`
  return jj('log', '-r', revset, '--no-graph', '-T', template)
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [change, commit, parents, kind, timestamp, bookmarks, description] = line.split('\t')
      return { change, commit, parents: parents.split(',').filter(Boolean), kind, timestamp, bookmarks, description }
    })
}

const workspaceOwners = () =>
  jj('workspace', 'list', '-T', `${T(['name', 'target.change_id().shortest(8)'])}`)
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [name, change] = line.split('\t')
      return { name, change }
    })

const mainPatchIndex = force => {
  const cache = join(stateDir, 'main-patches.json')
  const cached = loadJson(cache)
  if (cached && !force) {
    return cached
  }
  const table = {}
  for (const revision of revisionRows(`${base}..${bookmark}`)) {
    const patch = jj('diff', '--git', '-r', revision.commit)
    table[createHash('sha256').update(patch).digest('hex')] = { change: revision.change, description: revision.description }
  }
  json(cache, table)
  return table
}

const buildLanes = () => {
  const off = revisionRows(`${base}.. ~ ::${bookmark}`)
  const byChange = new Map(off.map(revision => [revision.change, revision]))
  const owners = Object.fromEntries(workspaceOwners().map(entry => [entry.change, entry.name]))
  const seen = new Set()
  const lanes = []
  for (const revision of off) {
    const hasOffParent = revision.parents.some(parent => byChange.has(parent))
    if (hasOffParent || seen.has(revision.change)) {
      continue
    }
    const component = []
    const stack = [revision.change]
    seen.add(revision.change)
    while (stack.length > 0) {
      const current = stack.pop()
      component.push(current)
      for (const candidate of off) {
        if (!seen.has(candidate.change) && candidate.parents.includes(current)) {
          seen.add(candidate.change)
          stack.push(candidate.change)
        }
      }
    }
    lanes.push(component)
  }
  const missed = off.filter(revision => !seen.has(revision.change)).map(revision => revision.change)
  if (missed.length > 0) {
    lanes.push(missed)
  }
  const index = mainPatchIndex(has('force'))
  return lanes
    .map(component => {
      const revisions = component.map(change => byChange.get(change)).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const ids = revisions.map(revision => revision.change)
      const contentful = revisions.filter(revision => revision.kind === 'C')
      const tips = ids.filter(id => !revisions.some(revision => revision.parents.includes(id)))
      const duplicates = contentful.filter(revision => index[createHash('sha256').update(jj('diff', '--git', '-r', revision.commit)).digest('hex')])
      const mainDescriptions = new Set(Object.values(index).map(entry => entry.description))
      return {
        ids,
        owners: [...new Set(ids.map(id => owners[id]).filter(Boolean))],
        tips,
        oldest: revisions[0]?.timestamp ?? '',
        contentful: contentful.length,
        empty: revisions.length - contentful.length,
        rootParents: [...new Set(revisions.flatMap(revision => revision.parents.filter(parent => !byChange.has(parent))))],
        duplicateCount: duplicates.length,
        superseded: contentful.length > 0 && contentful.every(revision => mainDescriptions.has(revision.description)),
        firstDescription: revisions[0]?.description ?? '',
      }
    })
    .sort((a, b) => (a.oldest === b.oldest ? a.ids[0].localeCompare(b.ids[0]) : a.oldest.localeCompare(b.oldest)))
}

const readTip = () => (existsSync(join(stateDir, 'tip.txt')) ? readFileSync(join(stateDir, 'tip.txt'), 'utf8').trim() : bookmark)
const writeTip = tip => writeFileSync(join(stateDir, 'tip.txt'), `${tip}\n`)
const laneIndex = () => loadJson(join(stateDir, 'lanes.json')) ?? buildLanes()
const log = record => appendFileSync(join(stateDir, 'resolutions.jsonl'), `${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`)
const conflictsIn = revset => jjTry('log', '-r', `(${revset}) & conflicts()`, '--no-graph', '-T', `${T([short, 'description.first_line()'])}`).out.split('\n').filter(Boolean)
const changedPaths = change => jj('diff', '-r', change, '--summary').split('\n').filter(Boolean).map(line => line.slice(2).trim())
const conflictedPaths = change => {
  const out = jjTry('resolve', '-r', change, '--list').out
  return out.split('\n').filter(Boolean).map(line => (/^(.*?)\s+\d+-sided conflict/.exec(line)?.[1] ?? line).trim())
}

const commands = {
  snapshot() {
    const op = jj('op', 'log', '--limit', '1', '--no-graph', '-T', 'id').trim()
    const range = `${base}..${bookmark}`
    const heads = jj('log', '-r', `heads(${range})`, '--no-graph', '-T', `${short} ++ "\\n"`).split('\n').filter(Boolean)
    const counts = {
      revisions: revisionRows(range).length,
      heads,
      merges: revisionRows(`${range} & merges()`).length,
      conflicts: conflictsIn(range).length,
      divergent: revisionRows('divergent()').length,
      empty: revisionRows(`${range} & empty()`).length,
    }
    writeFileSync(join(stateDir, 'restore-point.txt'), `${op}\n`)
    console.log(JSON.stringify({ restoreTo: `jj op restore ${op}`, stateDir, ...counts }, null, 1))
  },

  inventory() {
    const lanes = buildLanes()
    json(join(stateDir, 'lanes.json'), lanes)
    console.log(`lanes: ${lanes.length}  revisions: ${lanes.reduce((total, lane) => total + lane.ids.length, 0)}  state: ${stateDir}`)
    lanes.forEach((lane, at) =>
      console.log(
        [
          String(at).padStart(3),
          lane.oldest.slice(0, 16),
          String(lane.ids.length).padStart(4),
          String(lane.contentful).padStart(4),
          (lane.owners.join(',') || '-').slice(0, 34).padEnd(34),
          lane.superseded ? 'SUPERSEDED' : lane.duplicateCount > 0 ? `${lane.duplicateCount} dup` : 'unique',
          lane.firstDescription.slice(0, 46),
        ].join(' '),
      ),
    )
  },

  plan() {
    const lanes = laneIndex()
    writeFileSync(join(stateDir, 'lane-list.txt'), `${lanes.map(lane => lane.ids.join(' ')).join('\n')}\n`)
    writeTip(readTip())
    json(
      join(stateDir, 'plan.json'),
      lanes.map((lane, at) => ({ lane: at, owners: lane.owners, ids: lane.ids, superseded: lane.superseded, command: `jj rebase -r '${lane.ids.join('|')}' -o <tip>` })),
    )
    console.log(`plan written: ${lanes.length} lanes, oldest first, tip starting at ${readTip()}`)
  },

  rebase() {
    const at = Number(positional[0])
    const lanes = laneIndex()
    const lane = lanes[at]
    if (!lane) {
      throw new Error(`no lane ${at}`)
    }
    const revset = lane.ids.join(' | ')
    const tip = readTip()
    const before = new Set(conflictsIn(revset).map(line => line.split('\t')[0]))
    const result = jjTry('rebase', '-r', revset, '-o', tip)
    console.log(result.out.trim().split('\n').slice(0, 6).join('\n'))
    const after = conflictsIn(revset).map(line => line.split('\t')[0])
    const fresh = after.filter(change => !before.has(change))
    const mainDescriptions = new Set(Object.values(mainPatchIndex(false)).map(entry => entry.description))
    const autoEmpty = has('auto-empty') ? fresh.filter(change => mainDescriptions.has(jj('log', '-r', change, '--no-graph', '-T', 'description.first_line()').trim())) : []
    for (const change of autoEmpty) {
      commands.empty(change)
    }
    const rest = autoEmpty.length > 0 ? conflictsIn(revset).map(line => line.split('\t')[0]).filter(change => !before.has(change)) : fresh
    if (rest.length > 0) {
      console.log(`CONFLICTS lane ${at}: ${rest.join(' ')}`)
      console.log(`  resolve with: node linearize.mjs resolve ${at} --take-main   (then re-run verify)`)
      process.exitCode = 3
      return
    }
    const heads = jj('log', '-r', `heads(${revset})`, '--no-graph', '-T', `${short} ++ "\\n"`).split('\n').filter(Boolean)
    const next = heads.at(-1) ?? tip
    writeTip(next)
    console.log(`lane ${at} ok -> tip ${next}`)
  },

  empty() {
    for (const change of positional) {
      const paths = changedPaths(change)
      if (paths.length === 0) {
        console.log(`${change}: already empty`)
        continue
      }
      const description = jj('log', '-r', change, '--no-graph', '-T', 'description.first_line()').trim()
      jj('restore', '--from', `${change}-`, '--to', change, ...paths)
      log({ change, description, resolution: 'emptied: the same work is already present upstream', paths })
      console.log(`${change}: emptied ${paths.length} path(s)`)
    }
  },

  'take-main'() {
    for (const change of positional) {
      const paths = conflictedPaths(change)
      if (paths.length === 0) {
        console.log(`${change}: no conflicts`)
        continue
      }
      const description = jj('log', '-r', change, '--no-graph', '-T', 'description.first_line()').trim()
      jj('restore', '--from', `${change}-`, '--to', change, ...paths)
      log({ change, description, resolution: 'took the destination side for the conflicted paths', paths })
      console.log(`${change}: took the destination side for ${paths.length} path(s)`)
    }
  },

  preserve() {
    const at = Number(positional[0])
    const name = positional[1] ?? 'kept/lane'
    const lanes = laneIndex()
    const lane = lanes[at]
    if (!lane) {
      throw new Error(`no lane ${at}`)
    }
    const out = jj('duplicate', lane.ids.join(' | '))
    console.log(out.trim())
    const copies = out.split('\n').filter(Boolean).map(line => line.match(/as ([0-9a-z]+)/)?.[1]).filter(Boolean)
    const tip = copies.at(-1)
    if (tip) {
      jj('bookmark', 'create', name, '-r', tip)
    }
    console.log(`preserved lane ${at} as ${name} (${tip ?? 'unknown'}); originals stay hidden, no change-id divergence`)
  },

  skip() {
    const at = Number(positional[0])
    const reason = flag('reason', 'not integrated')
    const lane = laneIndex()[at]
    appendFileSync(join(stateDir, 'skipped.txt'), `${at}\t${lane?.ids.join('|') ?? ''}\t${reason}\n`)
    console.log(`lane ${at} skipped: ${reason}`)
  },

  prune() {
    const revset = `${base}..${bookmark} & empty() & ~working_copies() & ~bookmarks()`
    const candidates = revisionRows(revset)
    console.log(`${candidates.length} content-free empty revisions`)
    if (!has('apply')) {
      console.log('dry run; re-run with --apply to abandon them')
      return
    }
    if (candidates.length > 0) {
      console.log(jjTry('abandon', revset).out.trim())
    }
  },

  verify() {
    const range = `${base}..${bookmark}`
    const heads = revisionRows(`heads(${range})`)
    const merges = revisionRows(`${range} & merges()`)
    const conflicts = conflictsIn(range)
    const divergent = revisionRows('divergent()')
    const revisionCount = revisionRows(range).length
    const empty = revisionRows(`${range} & empty()`).length
    const owners = workspaceOwners()
    const unlanded = owners
      .map(entry => ({
        ...entry,
        contentful: jjTry('log', '-r', `(::${entry.name}@ ~ ::${bookmark}) & ~empty()`, '--no-graph', '-T', `${short} ++ "\\n"`).out.split('\n').filter(Boolean).length,
      }))
      .filter(entry => entry.contentful > 0)
    const checks = [
      ['one head', heads.length === 1],
      ['no merges', merges.length === 0],
      ['no conflicts', conflicts.length === 0],
      ['no divergence', divergent.length === 0],
    ]
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
    }
    console.log(`range: ${revisionCount} revisions, ${empty} empty, head ${heads[0]?.change ?? '-'}`)
    console.log(`workspaces still holding unlanded content: ${unlanded.length}`)
    for (const entry of unlanded) {
      console.log(`  ${entry.name} (@ ${entry.change}) -> ${entry.contentful} contentful revision(s)`)
    }
    if (checks.some(([, ok]) => !ok)) {
      process.exitCode = 1
    }
  },

  report() {
    const lanes = laneIndex()
    const onMain = new Set(revisionRows(`${base}..${bookmark}`).map(revision => revision.change))
    const resolutions = existsSync(join(stateDir, 'resolutions.jsonl'))
      ? readFileSync(join(stateDir, 'resolutions.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      : []
    const skipped = existsSync(join(stateDir, 'skipped.txt')) ? readFileSync(join(stateDir, 'skipped.txt'), 'utf8').split('\n').filter(Boolean) : []
    const lines = [
      `# Linearization report`,
      '',
      `Restore points: ${existsSync(join(stateDir, 'restore-point.txt')) ? '`jj op restore ' + readFileSync(join(stateDir, 'restore-point.txt'), 'utf8').trim() + '`' : 'none recorded'}`,
      '',
      `## Lanes (oldest first)`,
      '',
      '| # | owners | revisions | integrated on main | first subject |',
      '|---|---|---|---|---|',
      ...lanes.map((lane, at) => {
        const landed = lane.ids.filter(id => onMain.has(id)).length
        return `| ${at} | ${lane.owners.join(',') || '—'} | ${lane.ids.length} | ${landed}/${lane.ids.length} | ${lane.firstDescription.slice(0, 56)} |`
      }),
      '',
      `## Not integrated`,
      '',
      ...(skipped.length > 0 ? skipped.map(line => `- ${line}`) : ['- none recorded']),
      '',
      `## Conflict resolutions`,
      '',
      ...(resolutions.length > 0
        ? resolutions.map(entry => `- \`${entry.change}\` ${entry.description.slice(0, 52)} — ${entry.resolution} (${entry.paths.length} path(s))`)
        : ['- none recorded']),
      '',
    ]
    writeFileSync(join(stateDir, 'REPORT.md'), `${lines.join('\n')}\n`)
    console.log(`wrote ${join(stateDir, 'REPORT.md')}`)
  },
}

if (command === undefined || commands[command] === undefined) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 24).join('\n'))
  process.exitCode = 1
} else {
  commands[command]()
}
