import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HtmlPageLimits, htmlPageSchema } from './html-page.js'
import { createHtmlRenderHost, textOf } from './test-host.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const fixture = async () => {
  const host = await createHtmlRenderHost()
  cleanups.push(host.dispose)
  await mkdir(join(host.workspace, 'site', 'assets'), { recursive: true })
  return { workspace: host.workspace, outside: host.outside, preview: (args: unknown) => host.run('html_preview', args) }
}

describe('html_preview tool', () => {
  it('shows a workspace file with its simple relative assets inlined', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace, 'site', 'assets', 'style.css'), 'h1{color:var(--dsh-accent)} /* </style><script>x</script> */')
    await writeFile(join(f.workspace, 'site', 'assets', 'app.js'), 'document.body.dataset.ready = "1"')
    await writeFile(join(f.workspace, 'site', 'assets', 'dot.png'), PIXEL_PNG)
    await writeFile(
      join(f.workspace, 'site', 'index.html'),
      [
        '<!doctype html><html><head><link rel="stylesheet" href="assets/style.css"><link rel="stylesheet" href="https://cdn.example/x.css"></head>',
        '<body><h1>Report</h1><img alt="dot" src="./assets/dot.png"><img src="missing.png"><script type="module" src="assets/app.js"></script></body></html>',
      ].join(''),
    )
    const result = await f.preview({ path: 'site/index.html', height: 10 })
    expect(result.isError).toBe(false)
    const page = htmlPageSchema.parse(result.meta)
    expect(page).toMatchObject({ title: 'index.html', height: HtmlPageLimits.minHeight, theme: 'auto' })
    expect(page.html).toContain('<style data-dsh-source="assets/style.css">h1{color:var(--dsh-accent)} /* <\\/style><script>x</script> */</style>')
    expect(page.html).toContain(`src="data:image/png;base64,${PIXEL_PNG.toString('base64')}"`)
    expect(page.html).toContain('<script type="module" >document.body.dataset.ready = "1"</script>')
    expect(page.html).toContain('href="https://cdn.example/x.css"')
    const text = textOf(result.content)
    expect(text).toContain('Showing site/index.html as "index.html"')
    expect(text).toContain('Inlined 3 relative asset(s).')
    expect(text).toContain('missing.png: not found')
    expect(text).not.toContain('<h1>')
  })

  it('refuses a path outside the workspace, including through a symlink, and never inlines an outside asset', async () => {
    const f = await fixture()
    await writeFile(join(f.outside, 'secret.html'), '<p>secret</p>')
    await writeFile(join(f.outside, 'secret.css'), 'body{--secret:1}')
    await symlink(join(f.outside, 'secret.html'), join(f.workspace, 'linked.html'))
    await symlink(join(f.outside, 'secret.css'), join(f.workspace, 'linked.css'))
    await writeFile(join(f.workspace, 'page.html'), '<link rel="stylesheet" href="../outside/secret.css"><link rel="stylesheet" href="linked.css"><p>ok</p>')

    for (const path of ['../outside/secret.html', join(f.outside, 'secret.html'), 'linked.html']) {
      const refused = await f.preview({ path })
      expect(refused.isError).toBe(true)
      expect(textOf(refused.content)).toContain('is outside this thread’s workspace')
    }

    const page = await f.preview({ path: 'page.html' })
    expect(page.isError).toBe(false)
    expect(htmlPageSchema.parse(page.meta).html).not.toContain('--secret')
    expect(textOf(page.content)).toContain('../outside/secret.css: outside the thread workspace; linked.css: outside the thread workspace')
  })

  it('refuses non-HTML, missing, oversized and non-UTF-8 files with a recovery path', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace, 'notes.txt'), 'hello')
    await writeFile(join(f.workspace, 'big.html'), 'x'.repeat(HtmlPageLimits.maxHtmlBytes + 1))
    await writeFile(join(f.workspace, 'latin1.html'), Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]))
    const cases = [
      { path: 'notes.txt', message: 'is not an .html file' },
      { path: 'absent.html', message: 'does not exist' },
      { path: 'big.html', message: 'html_preview shows at most 512.0 KB' },
      { path: 'latin1.html', message: 'is not UTF-8 text' },
    ]
    for (const entry of cases) {
      const result = await f.preview({ path: entry.path })
      expect(result.isError).toBe(true)
      expect(textOf(result.content)).toContain(entry.message)
    }
  })
})
