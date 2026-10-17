import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DshPlatformLaunchUrl } from '../src/platform/client.js'
import * as publicPlatform from '../src/platform/index.js'

describe('DSH launch URL resolution', () => {
  let dshHome: string
  beforeEach(() => {
    dshHome = mkdtempSync(join(tmpdir(), 'dshx-home-'))
  })
  afterEach(() => rmSync(dshHome, { recursive: true, force: true }))

  it('publicly adapts loopback parsing without exposing internal helpers', () => {
    expect(publicPlatform.loopbackLaunchUrl('http://127.0.0.1:3080/?token=public')).toEqual({ origin: 'http://127.0.0.1:3080', token: 'public' })
    expect(publicPlatform).not.toHaveProperty('DshPlatformLaunchUrl')
    expect(publicPlatform).not.toHaveProperty('resolveLaunchUrl')
  })

  it('prefers the explicit URL, then DSHX_URL, then the URL the supervisor recorded', () => {
    mkdirSync(join(dshHome, 'runtime'))
    writeFileSync(join(dshHome, 'runtime', 'web-url'), 'http://127.0.0.1:3080/?token=recorded\n')
    expect(DshPlatformLaunchUrl.resolveLaunchUrl('http://127.0.0.1:1/?token=explicit', { DSHX_URL: 'http://127.0.0.1:2/?token=env', DSH_HOME: dshHome })).toBe(
      'http://127.0.0.1:1/?token=explicit',
    )
    expect(DshPlatformLaunchUrl.resolveLaunchUrl(undefined, { DSHX_URL: 'http://127.0.0.1:2/?token=env', DSH_HOME: dshHome })).toBe(
      'http://127.0.0.1:2/?token=env',
    )
    expect(DshPlatformLaunchUrl.resolveLaunchUrl(undefined, { DSH_HOME: dshHome })).toBe('http://127.0.0.1:3080/?token=recorded')
  })

  it('finds nothing when no URL was recorded', () => {
    expect(DshPlatformLaunchUrl.resolveLaunchUrl(undefined, { DSH_HOME: dshHome })).toBeUndefined()
  })
})
