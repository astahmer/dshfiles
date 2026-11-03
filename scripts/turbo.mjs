import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { turboCacheDir } from './turbo-cache.mjs'

// Turbo's default is ten concurrent tasks; the plugin suites spawn real jj, git, node and Playwright and start failing
// each other's timers above four on this machine class. Explicit TURBO_CONCURRENCY still wins.
const inCi = !['', '0', 'false'].includes(process.env.CI ?? '')
// A CI runner is small and shared: two plugin suites at once already OOM-kills the vitest fork that mounts a real Host.
const concurrency = process.env.TURBO_CONCURRENCY ?? (inCi ? '1' : String(Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))))

// Package scripts and the supervisor start turbo through here so every JJ workspace shares one cache, inside or
// outside the Nix dev shell; a thread workspace with its own empty cache rebuilds everything once.
const child = spawn('turbo', process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, TURBO_CACHE_DIR: turboCacheDir(), TURBO_CONCURRENCY: concurrency },
})
child.once('error', error => {
  console.error(`turbo: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 128)
})
