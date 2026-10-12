#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Real-jj test harness. No mocks: every scenario builds an actual Jujutsu
 * repository and, where the scenario is about concurrency, drives two or more
 * OS processes against it.
 */

const here = dirname(fileURLToPath(import.meta.url))

export const realJj = (() => {
  const fromEnv = process.env.JJ_ISOLATION_REAL_JJ
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  return execFileSync('sh', ['-c', 'command -v jj'], { encoding: 'utf8' }).trim()
})()

export const shimDir = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-isolation-bin-'))
  const target = join(dir, 'jj')
  const template = readFileSync(join(here, 'shim-jj.sh'), 'utf8')
  writeFileSync(target, template.replace('@GUARD@', join(here, 'cli.mjs')).replace('@REAL_JJ@', realJj), 'utf8')
  chmodSync(target, 0o755)
  return dir
})()

export const run = ({ file = realJj, args, cwd, env, input }) =>
  spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    input,
    env: { ...process.env, JJ_ISOLATION_REAL_JJ: realJj, ...env },
  })

export const jj = ({ cwd, args }) => run({ args, cwd })

/** Runs a command as an agent would: through the shim, so the guard is in play. */
export const guarded = ({ cwd, args, env }) => run({ file: join(shimDir, 'jj'), args, cwd, env })

export const jjOk = ({ cwd, args }) => {
  const result = jj({ cwd, args })
  if (result.status !== 0) throw new Error(`setup: jj ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`)
  return result.stdout.trimEnd()
}

export const mkRepo = ({ name = 'repo' } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'jj-isolation-'))
  const repo = join(root, name)
  mkdirSync(repo, { recursive: true })
  jjOk({ cwd: root, args: ['git', 'init', '--no-colocate', repo] })
  writeFileSync(join(repo, 'spine.txt'), 'spine\n')
  jjOk({ cwd: repo, args: ['describe', '-m', 'spine base'] })
  return repo
}

export const head = cwd => jjOk({ cwd, args: ['log', '-r', '@', '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })

export const workspaceHeads = cwd => {
  const rows = jjOk({ cwd, args: ['workspace', 'list', '-T', 'name ++ "\\t" ++ target.commit_id() ++ "\\n"', '--ignore-working-copy'] })
  return Object.fromEntries(
    rows
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, commit] = line.split('\t')
        return [name, commit]
      }),
  )
}

export const addWorkspace = ({ repo, root, name, revision = '@' }) => {
  const path = join(root, name)
  jjOk({ cwd: repo, args: ['workspace', 'add', path, '--name', name, '-r', revision] })
  return path
}

export const commitIdOf = ({ cwd, revision }) => jjOk({ cwd, args: ['log', '-r', revision, '--no-graph', '-T', 'commit_id', '--ignore-working-copy'] })

export const writeFeatureFiles = ({ dir, count, tag = '' }) => {
  for (let index = 1; index <= count; index += 1) writeFileSync(join(dir, `feature-${tag}${index}.txt`), `work ${index}\n`)
}

export const featureFilesOnDisk = ({ dir, tag = '' }) =>
  existsSync(dir) ? readdirSync(dir).filter(name => name.startsWith(`feature-${tag}`)).length : 0

export const duplicatedChangeIds = cwd => {
  const ids = jjOk({ cwd, args: ['log', '-r', 'all()', '--no-graph', '-T', 'change_id ++ "\\n"', '--ignore-working-copy'] })
    .split('\n')
    .filter(Boolean)
  const seen = new Set()
  const duplicated = new Set()
  for (const id of ids) (seen.has(id) ? duplicated : seen).add(id)
  return [...duplicated]
}

/** Where does the content currently live? Used to prove work is recoverable, not destroyed. */
export const commitsHolding = ({ cwd, prefix }) =>
  jjOk({ cwd, args: ['log', '-r', 'all()', '--no-graph', '-T', 'commit_id ++ "\\n"', '--ignore-working-copy'] })
    .split('\n')
    .filter(Boolean)
    .filter(commitId => {
      const files = jj({ cwd, args: ['file', 'list', '-r', commitId, '-T', 'path ++ "\\n"', '--ignore-working-copy'] })
      return files.status === 0 && files.stdout.includes(prefix)
    })

export const enableIsolation = (repo, overrides = {}) => {
  const path = join(repo, '.jj', 'jj-isolation.json')
  const config = { version: 1, base: 'integration-spine', ...overrides }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}

export const disabledEnv = { JJ_ISOLATION: 'off' }

export const spawnMany = commands =>
  Promise.all(
    commands.map(
      command =>
        new Promise(resolvePromise => {
          const child = spawnSync(command.file ?? realJj, command.args, {
            cwd: command.cwd,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env, JJ_ISOLATION_REAL_JJ: realJj, ...command.env },
          })
          resolvePromise(child)
        }),
    ),
  )

/** Starts both processes before either is awaited, so they genuinely overlap. */
export const overlap = commands => {
  const children = commands.map(command =>
    spawn(command.file ?? realJj, command.args, {
      cwd: command.cwd,
      env: { ...process.env, JJ_ISOLATION_REAL_JJ: realJj, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  return Promise.all(
    children.map(
      child =>
        new Promise(resolvePromise => {
          let stdout = ''
          let stderr = ''
          child.stdout.on('data', chunk => {
            stdout += chunk
          })
          child.stderr.on('data', chunk => {
            stderr += chunk
          })
          child.on('close', status => resolvePromise({ status, stdout, stderr }))
        }),
    ),
  )
}

export const resolveShim = () => join(shimDir, 'jj')
