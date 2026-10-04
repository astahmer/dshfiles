import { describe, expect, it } from 'vitest'
import { nextSecretRevealStage, previewSecretValue } from './secret-reveal-model.js'

describe('Secret Catalog reveal stages', () => {
  it('cycles from preview to full to hidden', () => {
    expect(nextSecretRevealStage('preview')).toBe('full')
    expect(nextSecretRevealStage('full')).toBeNull()
  })

  it('previews long values at both ends and keeps short values masked', () => {
    expect(previewSecretValue('SYNTHETIC_SECRET_VALUE_123')).toStrictEqual({ kind: 'excerpt', text: 'SYNT…_123' })
    expect(previewSecretValue('SHORT')).toStrictEqual({ kind: 'masked', mask: '••••••••', length: 5 })
  })
})
