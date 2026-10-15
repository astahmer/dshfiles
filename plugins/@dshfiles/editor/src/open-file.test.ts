import { describe, expect, it } from 'vitest'
import { OpenFileAddress } from './open-file.js'

describe('file link addresses', () => {
  it('decodes session addresses the way the Host builds them, absolute paths included', () => {
    expect(OpenFileAddress.parse('dsh-resource://file/session/ses_1/src/a%20b.ts?x#y')).toEqual({ sessionId: 'ses_1', path: 'src/a b.ts' })
    expect(OpenFileAddress.parse('dsh-resource://file/session/ses_1//Users/me/w/a.ts')).toEqual({ sessionId: 'ses_1', path: '/Users/me/w/a.ts' })
    expect(OpenFileAddress.parse('dsh-resource://file/absolute/Users/me/a.ts')).toBeUndefined()
    expect(OpenFileAddress.parse('dsh-resource://file/session/ses_1/%E0')).toBeUndefined()
    expect(OpenFileAddress.parse('sidebar://guide')).toBeUndefined()
  })

  it('claims code and images but leaves documents, folders and session-less addresses to the Host preview', () => {
    expect(OpenFileAddress.claims('dsh-resource://file/session/ses_1/src/index.ts')).toBe(true)
    expect(OpenFileAddress.claims('dsh-resource://file/session/ses_1/logo.PNG')).toBe(true)
    expect(OpenFileAddress.claims('dsh-resource://file/session/ses_1/report.pdf')).toBe(false)
    expect(OpenFileAddress.claims('dsh-resource://file/session/ses_1/slides.PPTX')).toBe(false)
    expect(OpenFileAddress.claims('dsh-resource://file/session/ses_1/src/')).toBe(false)
    expect(OpenFileAddress.claims('dsh-resource://file/absolute/etc/hosts')).toBe(false)
  })
})
