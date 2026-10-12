import { register } from 'node:module'

process.on('unhandledRejection', reason => {
  console.error('[PROBE] unhandledRejection:', reason && reason.stack ? reason.stack : reason)
})
process.on('uncaughtException', error => {
  console.error('[PROBE] uncaughtException:', error && error.stack ? error.stack : error)
})
register('/tmp/probe-hooks.mjs', import.meta.url)
