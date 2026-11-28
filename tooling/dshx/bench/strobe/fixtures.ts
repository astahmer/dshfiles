import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export const shortThreadA = 'Strobe benchmark A'
export const largeThreadMarker = 'strobe large history marker'
export const viewport = { width: 1440, height: 900 }

export function scratchFixture() {
  const stateDir = join(process.env.DSHX_DEV_STATE_ROOT ?? join(tmpdir(), 'dshx-dev'), 'strobe-bench')
  const state = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'))
  const url = new URL(state.launchUrl)
  if (state.name !== 'strobe-bench' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== String(state.port) || url.port === '3080') {
    throw new Error('Expected the isolated strobe-bench scratch instance state.')
  }
  return { launchUrl: url.href, stateDir, projectName: basename(state.project.path) }
}

export function fixtureIds(stateDir: string) {
  const path = join(stateDir, 'strobe-bench-fixtures.json')
  let saved
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Run seed-fixtures.mjs against the strobe-bench scratch instance first.')
  }
  const { a, b, large } = saved
  if ([a, b, large].some(id => typeof id !== 'string' || id.length === 0) || new Set([a, b, large]).size !== 3) {
    throw new Error('Fixture must contain three distinct scratch Session ids; rerun seed-fixtures.mjs.')
  }
  return { a: String(a), b: String(b), large: String(large) }
}
