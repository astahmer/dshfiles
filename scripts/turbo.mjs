import { spawn } from 'node:child_process'
import { turboCacheDir } from './turbo-cache.mjs'

// Package scripts and the supervisor start turbo through here so every JJ workspace shares one cache, inside or
// outside the Nix dev shell; a thread workspace with its own empty cache rebuilds everything once.
const child = spawn('turbo', process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, TURBO_CACHE_DIR: turboCacheDir() } })
child.once('error', error => {
  console.error(`turbo: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 128)
})
