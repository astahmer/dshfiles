import { describe, expect, it } from 'vitest'
import { buildPreviewDocument } from '../src/preview-document.js'

const nonce = 'nonce-1234'

describe('buildPreviewDocument', () => {
  it('removes the page scripts and inline handlers', () => {
    const html = '<body><button onclick="steal()">Pay</button><script>window.x=1</script></body>'
    const built = buildPreviewDocument({ html, nonce })
    expect(built).not.toContain('steal()')
    expect(built).not.toContain('window.x=1')
    expect(built).toContain('<button>Pay</button>')
  })

  it('inserts the inspector before the body end with its nonce', () => {
    const built = buildPreviewDocument({ html: '<body><p>hi</p></body>', nonce })
    expect(built).toContain('nonce-1234')
    expect(built.indexOf('nonce-1234')).toBeLessThan(built.indexOf('</body>'))
    expect(built.match(/<script>/g)).toHaveLength(1)
  })

  it('appends the inspector for a fragment without a body', () => {
    const built = buildPreviewDocument({ html: '<p>hi</p>', nonce })
    expect(built.startsWith('<p>hi</p>')).toBe(true)
    expect(built).toContain('nonce-1234')
  })

  it('drops javascript: urls', () => {
    const built = buildPreviewDocument({ html: '<a href="javascript:alert(1)">x</a>', nonce })
    expect(built).not.toContain('javascript:')
  })
})
