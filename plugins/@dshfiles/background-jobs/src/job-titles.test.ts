import { describe, expect, it } from 'vitest'
import { JobTitles } from './job-titles.js'

describe('JobTitles.descriptionOf', () => {
  it('reads the trimmed description of a call', () => {
    expect(JobTitles.descriptionOf('{"command":"pnpm build","description":"  Build  "}')).toBe('Build')
  })

  it('names nothing for a missing, blank or non-string description, unparsable arguments or none', () => {
    expect(JobTitles.descriptionOf('{"command":"pnpm build"}')).toBeUndefined()
    expect(JobTitles.descriptionOf('{"description":"   "}')).toBeUndefined()
    expect(JobTitles.descriptionOf('{"description":42}')).toBeUndefined()
    expect(JobTitles.descriptionOf('"Build"')).toBeUndefined()
    expect(JobTitles.descriptionOf('{not json')).toBeUndefined()
    expect(JobTitles.descriptionOf(undefined)).toBeUndefined()
  })
})
