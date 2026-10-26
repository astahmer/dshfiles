import { describe, expect, it } from 'vitest'
import { collapseText, privateAncestor, redactUrl, safeAttributes, sensitiveField } from '../src/redact.js'

describe('redactUrl', () => {
  it('keeps the origin and pathname only', () => {
    expect(redactUrl('http://127.0.0.1:3080/settings?token=secret#frag')).toBe('http://127.0.0.1:3080/settings')
  })

  it('drops credentials and query from a remote url', () => {
    expect(redactUrl('https://user:pw@example.com/a/b?q=1')).toBe('https://example.com/a/b')
  })

  it('returns a non-http scheme without its payload', () => {
    expect(redactUrl('blob:http://127.0.0.1:3080/1234')).toBe('blob:')
  })

  it('returns an empty string for an unparsable url', () => {
    expect(redactUrl('not a url')).toBe('')
  })
})

describe('collapseText', () => {
  it('collapses whitespace and trims', () => {
    expect(collapseText('  a \n b\t c  ')).toBe('a b c')
  })

  it('returns undefined for empty content', () => {
    expect(collapseText('   ')).toBeUndefined()
    expect(collapseText(null)).toBeUndefined()
  })

  it('caps at the documented length', () => {
    expect(collapseText('x'.repeat(400))?.length).toBe(240)
  })
})

describe('element guards', () => {
  it('finds a private ancestor', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-private', '')
    const child = document.createElement('span')
    wrapper.append(child)
    document.body.append(wrapper)
    expect(privateAncestor(child)).toBe(wrapper)
    expect(privateAncestor(document.body)).toBeUndefined()
  })

  it('treats form fields and contenteditable as sensitive', () => {
    expect(sensitiveField(document.createElement('input'))).toBe(true)
    expect(sensitiveField(document.createElement('textarea'))).toBe(true)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(sensitiveField(editable)).toBe(true)
    expect(sensitiveField(document.createElement('div'))).toBe(false)
  })
})

describe('safeAttributes', () => {
  it('keeps only allowlisted attributes', () => {
    const element = document.createElement('button')
    element.setAttribute('data-testid', 'rebase')
    element.setAttribute('aria-label', 'Rebase thread')
    element.setAttribute('value', 'secret')
    element.setAttribute('data-random', 'drop me')
    expect(safeAttributes(element)).toEqual({ 'data-testid': 'rebase', 'aria-label': 'Rebase thread' })
  })

  it('returns undefined when nothing is allowlisted', () => {
    expect(safeAttributes(document.createElement('div'))).toBeUndefined()
  })
})
