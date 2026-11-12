import { describe, expect, it } from 'vitest'
import { imageTitleFallback } from './image-title.js'

describe('image title fallback', () => {
  it('shows a readable label only for an image-only title', () => {
    expect(imageTitleFallback('![image.png](dsh-context://v1/image/image_abc123)')).toBe('Image: image.png')
    expect(imageTitleFallback('![](dsh-context://v1/image/image_abc123)')).toBe('Image')
    expect(imageTitleFallback('Fix ![image.png](dsh-context://v1/image/image_abc123)')).toBe('Fix ![image.png](dsh-context://v1/image/image_abc123)')
  })
})
