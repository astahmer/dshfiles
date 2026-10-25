import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { readPreview } from '../src/preview.js'

const root = async (): Promise<string> => mkdtemp(join(tmpdir(), 'dsh-preview-'))

describe('readPreview', () => {
  it('reads an html file inside the root', async () => {
    const base = await root()
    await writeFile(join(base, 'page.html'), '<p>hi</p>')
    const result = await readPreview({ root: base, path: 'page.html' })
    if (!result.ok) throw new Error(result.error)
    expect(result.value.html).toBe('<p>hi</p>')
    expect(result.value.path).toBe('page.html')
  })

  it('refuses a path outside the root', async () => {
    const base = await root()
    const result = await readPreview({ root: base, path: '../escape.html' })
    expect(result).toEqual({ ok: false, error: 'outside-workspace' })
  })

  it('refuses another file type', async () => {
    const base = await root()
    await writeFile(join(base, 'notes.md'), '# hi')
    expect(await readPreview({ root: base, path: 'notes.md' })).toEqual({ ok: false, error: 'unsupported' })
  })

  it('reports a missing file', async () => {
    const base = await root()
    await mkdir(join(base, 'sub'), { recursive: true })
    expect(await readPreview({ root: base, path: 'sub/missing.html' })).toEqual({ ok: false, error: 'missing' })
  })

  it('records the preview read span', async () => {
    const base = await root()
    await writeFile(join(base, 'page.html'), '<p>hi</p>')
    using recorder = recordSpans()
    await readPreview({ root: base, path: 'page.html' })
    expect(recorder.span('annotations read preview')).toBeDefined()
  })
})
