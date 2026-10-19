#!/usr/bin/env node

/**
 * Compare native forks (plugins whose `native-fork.json` records a vendored DSH package) with upstream.
 *
 *   node scripts/native-fork-diff.mjs [fork ...]              drift: vendored files that differ from the pinned ref
 *                                                              but are not in the recorded delta, and stale delta entries
 *   node scripts/native-fork-diff.mjs <fork> --to <ref>       upgrade: upstream files changed from the pinned ref to <ref>,
 *                                                              split into plain copies and files carrying a local delta
 *
 * Upstream is a blobless clone cached in ~/.cache/dshfiles/deepseek-harness; blobs are fetched on first read.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsRoot = join(workspace, 'plugins/@dshfiles')
const cache = join(homedir(), '.cache/dshfiles/deepseek-harness')

const git = (args, options = {}) => execFileSync('git', ['-C', cache, ...args], { maxBuffer: 256 * 1024 * 1024, ...options })

const ensureRef = (repository, ref) => {
  if (!existsSync(cache)) execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', repository, cache], { stdio: 'inherit' })
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' })
  } catch {
    git(['fetch', '--quiet', '--filter=blob:none', 'origin', /^[0-9a-f]{40}$/.test(ref) ? ref : `refs/tags/${ref}:refs/tags/${ref}`], { stdio: 'inherit' })
  }
}

const upstreamFiles = (ref, path) =>
  String(git(['ls-tree', '-r', '--name-only', ref, '--', path]))
    .split('\n')
    .filter(Boolean)

const localFiles = root => {
  if (!existsSync(root)) return []
  if (statSync(root).isFile()) return [root]
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
}

const readFork = name => {
  const manifestPath = join(pluginsRoot, name, 'native-fork.json')
  if (!existsSync(manifestPath)) throw new Error(`${name} has no native-fork.json`)
  return { name, root: join(pluginsRoot, name), manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }
}

/** Every vendored local file paired with its upstream path at the pinned ref. */
const vendoredPairs = fork => {
  const { upstream, files } = fork.manifest
  return files.flatMap(mapping => {
    const upstreamRoot = `${upstream.path}/${mapping.upstream}`
    return upstreamFiles(upstream.ref, upstreamRoot).map(upstreamPath => ({
      upstreamPath,
      local: join(mapping.local, upstreamPath.slice(upstreamRoot.length)).replace(/\/$/, ''),
    }))
  })
}

const drift = fork => {
  const { upstream, files, delta } = fork.manifest
  ensureRef(upstream.repository, upstream.ref)
  const deltaFiles = new Set(delta)
  const pairs = vendoredPairs(fork)
  const vendored = new Set(pairs.map(pair => pair.local))
  const undeclared = []
  const staleDelta = []
  const missing = []
  for (const pair of pairs) {
    const localPath = join(fork.root, pair.local)
    if (!existsSync(localPath)) {
      missing.push(pair.local)
      continue
    }
    const same = Buffer.compare(git(['show', `${upstream.ref}:${pair.upstreamPath}`]), readFileSync(localPath)) === 0
    if (!same && !deltaFiles.has(pair.local)) undeclared.push(pair.local)
    if (same && deltaFiles.has(pair.local)) staleDelta.push(pair.local)
  }
  const added = files
    .flatMap(mapping => localFiles(join(fork.root, mapping.local)))
    .map(path => relative(fork.root, path))
    .filter(path => !vendored.has(path))
  const report = { fork: fork.name, upstream: `${upstream.package}@${upstream.version} (${upstream.ref})`, undeclared, staleDelta, missing, added }
  console.log(JSON.stringify(report, null, 2))
  return undeclared.length + staleDelta.length + missing.length + added.length === 0
}

const upgrade = (fork, target) => {
  const { upstream, delta } = fork.manifest
  ensureRef(upstream.repository, upstream.ref)
  ensureRef(upstream.repository, target)
  const deltaFiles = new Set(delta)
  const localOf = new Map(vendoredPairs(fork).map(pair => [pair.upstreamPath, pair.local]))
  const changes = String(git(['diff', '--name-status', upstream.ref, target, '--', upstream.path]))
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status, path] = line.split('\t')
      const local = localOf.get(path)
      return { status, upstream: path, local: local ?? null, delta: local !== undefined && deltaFiles.has(local) }
    })
  console.log(
    JSON.stringify(
      {
        fork: fork.name,
        from: upstream.ref,
        to: target,
        reapplyDelta: changes.filter(change => change.delta),
        copy: changes.filter(change => !change.delta),
      },
      null,
      2,
    ),
  )
}

const args = process.argv.slice(2)
const toIndex = args.indexOf('--to')
if (toIndex !== -1) {
  const target = args[toIndex + 1]
  const [name] = args.filter((_, index) => index !== toIndex && index !== toIndex + 1)
  if (name === undefined || target === undefined) throw new Error('usage: native-fork-diff.mjs <fork> --to <ref>')
  upgrade(readFork(name), target)
} else {
  const names = args.length > 0 ? args : readdirSync(pluginsRoot).filter(name => existsSync(join(pluginsRoot, name, 'native-fork.json')))
  const clean = names.map(name => drift(readFork(name))).every(Boolean)
  process.exitCode = clean ? 0 : 1
}
