import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'destination-bar.tsx'), 'utf8')

// Council round 16 C1: the composer folds the host and this workspace segment into one location chip that names the
// working location only when it differs from the default; the segment says when it keeps that default.
describe('the composer workspace segment', () => {
  it('marks the choice that matches Settings › isolate by default with data-location-default', () => {
    const start = source.indexOf('aria-label={segmentName}')
    expect(start).toBeGreaterThan(-1)
    const segment = source.slice(start, source.indexOf('>', start))
    expect(segment).toContain("data-location-default={isolated === isolateByDefault ? '' : undefined}")
  })
})
