import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveLaunchUrl } from '../src/platform/client.js'

describe('DSH launch URL resolution', () => {
  let dshHome: string
  beforeEach(() => {
    dshHome = mkdtempSync(join(tmpdir(), 'dshx-home-'))
  })
  afterEach(() => rmSync(dshHome, { recursive: true, force: true }))

  it('prefers the explicit URL, then DSHX_URL, then the URL the supervisor recorded', () => {
    mkdirSync(join(dshHome, 'runtime'))
    writeFileSync(join(dshHome, 'runtime', 'web-url'), 'http://127.0.0.1:3080/?token=recorded\n')
    expect(resolveLaunchUrl('http://127.0.0.1:1/?token=explicit', { DSHX_URL: 'http://127.0.0.1:2/?token=env', DSH_HOME: dshHome })).toBe(
      'http://127.0.0.1:1/?token=explicit',
    )
    expect(resolveLaunchUrl(undefined, { DSHX_URL: 'http://127.0.0.1:2/?token=env', DSH_HOME: dshHome })).toBe('http://127.0.0.1:2/?token=env')
    expect(resolveLaunchUrl(undefined, { DSH_HOME: dshHome })).toBe('http://127.0.0.1:3080/?token=recorded')
  })

  it('finds nothing when no URL was recorded', () => {
    expect(resolveLaunchUrl(undefined, { DSH_HOME: dshHome })).toBeUndefined()
  })
})
