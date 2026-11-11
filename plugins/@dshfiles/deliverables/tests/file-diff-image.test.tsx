import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileDiff } from '../src/native/FileDiff.tsx'

const t = (key: string): string => key

const render = (input: { kind: 'binary' | 'oversized'; path: string; imageUrl?: string }): string =>
  renderToStaticMarkup(
    <FileDiff
      state={{ kind: input.kind, path: input.path, display: input.path }}
      split={false}
      wrap={false}
      retry={() => {}}
      t={t}
      {...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl })}
    />,
  )

describe('FileDiff for a binary changed file', () => {
  it('reads a changed image instead of the binary placeholder', () => {
    const markup = render({ kind: 'binary', path: 'docs/screenshots/getting-started-390.png', imageUrl: 'api/changes.image?index=0' })
    expect(markup).not.toContain('diff.binary')
    expect(markup).toContain('diff.loading')
  })

  it('reads an image too large for a comparison instead of the oversized placeholder', () => {
    expect(render({ kind: 'oversized', path: 'hero.webp', imageUrl: 'api/changes.image?index=1' })).not.toContain('diff.oversized')
  })

  it('keeps the placeholder for a binary file that is not an image', () => {
    expect(render({ kind: 'binary', path: 'dist/app.wasm', imageUrl: 'api/changes.image?index=2' })).toContain('diff.binary')
  })
})
