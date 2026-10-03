// Read-only coordination: project metadata and tool descriptions, never tool arguments/results.
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const cache = join(homedir(), '.dsh/storages/session_projcache/sessions')
const title = process.argv[2] ?? 'ok i need a dsh'
for (const name of readdirSync(cache)) {
  if (!name.endsWith('.json')) continue
  const { record } = JSON.parse(readFileSync(join(cache, name), 'utf8'))
  if (record.rows.title?.val !== title) continue
  const id = name.slice(0, -5)
  console.log(JSON.stringify({ id, title, cwd: record.identity.cwd, boundary: record.rows.turnBoundary.val, goal: record.rows.goal.val.current?.goal?.phase }))
  const cwdKey = `--${record.identity.cwd.split('/').filter(Boolean).join('-')}--`
  const path = join(homedir(), '.dsh/sessions', cwdKey, id, 'session.v4.jsonl.zstd')
  const nixZstd = readdirSync('/nix/store').find(name => name.endsWith('-zstd-1.5.7-bin'))
  const zstd = process.env.DSH_STATUS_ZSTD ?? (nixZstd ? join('/nix/store', nixZstd, 'bin/zstd') : 'zstd')
  const events = execFileSync(zstd, ['-dc', path], { maxBuffer: 256 * 1024 * 1024 }).toString().trim().split('\n')
  const calls = events.slice(-150).map(line => JSON.parse(line)).filter(event => event.type === 'tool/call')
  for (const event of calls.slice(-5)) {
    let args
    try { args = JSON.parse(event.data.arguments) } catch { args = {} }
    console.log(JSON.stringify({ seq: event.seq, tool: event.data.name, description: args.description ?? args.title ?? '(no description)' }))
  }
}
