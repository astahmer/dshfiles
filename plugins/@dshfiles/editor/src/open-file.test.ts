import { describe, expect, it } from 'vitest'
import { editorClaimsFileAddress, parseSessionFileAddress } from './open-file.js'

describe('file link addresses', () => {
  it('decodes session addresses the way the Host builds them, absolute paths included', () => {
    expect(parseSessionFileAddress('dsh-resource://file/session/ses_1/src/a%20b.ts?x#y')).toEqual({ sessionId: 'ses_1', path: 'src/a b.ts' })
    expect(parseSessionFileAddress('dsh-resource://file/session/ses_1//Users/me/w/a.ts')).toEqual({ sessionId: 'ses_1', path: '/Users/me/w/a.ts' })
    expect(parseSessionFileAddress('dsh-resource://file/absolute/Users/me/a.ts')).toBeUndefined()
    expect(parseSessionFileAddress('dsh-resource://file/session/ses_1/%E0')).toBeUndefined()
    expect(parseSessionFileAddress('sidebar://guide')).toBeUndefined()
  })

  it('claims code and images but leaves documents, folders and session-less addresses to the Host preview', () => {
    expect(editorClaimsFileAddress('dsh-resource://file/session/ses_1/src/index.ts')).toBe(true)
    expect(editorClaimsFileAddress('dsh-resource://file/session/ses_1/logo.PNG')).toBe(true)
    expect(editorClaimsFileAddress('dsh-resource://file/session/ses_1/report.pdf')).toBe(false)
    expect(editorClaimsFileAddress('dsh-resource://file/session/ses_1/slides.PPTX')).toBe(false)
    expect(editorClaimsFileAddress('dsh-resource://file/session/ses_1/src/')).toBe(false)
    expect(editorClaimsFileAddress('dsh-resource://file/absolute/etc/hosts')).toBe(false)
  })
})
