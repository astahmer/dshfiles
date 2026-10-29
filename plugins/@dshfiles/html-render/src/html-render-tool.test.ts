import { describe, expect, it } from 'vitest'
import { HtmlPageLimits, HtmlPageModel, htmlPageSchema } from './html-page.js'
import { createHtmlRenderHost, textOf } from './test-host.js'

const runTool = async (args: unknown) => {
  const host = await createHtmlRenderHost()
  try {
    return await host.run('html_render', args)
  } finally {
    await host.dispose()
  }
}

describe('html_render tool', () => {
  it('persists the page as presentation metadata and tells the model only a summary', async () => {
    const html = '<h1>Revenue</h1><script>document.body.dataset.ready = "1"</script>'
    const result = await runTool({ title: 'Revenue chart', html, height: 5000, theme: 'dark' })
    expect(result.isError).toBe(false)
    expect(htmlPageSchema.parse(result.meta)).toEqual({ title: 'Revenue chart', html, height: HtmlPageLimits.maxHeight, theme: 'dark' })
    const text = textOf(result.content)
    expect(text).toContain('Published "Revenue chart"')
    expect(text).not.toContain('<h1>')
  })

  it('refuses a page over the size cap with a recovery path', async () => {
    const result = await runTool({ title: 'Too big', html: 'x'.repeat(HtmlPageLimits.maxHtmlBytes + 1) })
    expect(result.isError).toBe(true)
    expect(textOf(result.content)).toMatch(/html is 512\.0 KB; html_render accepts at most 512\.0 KB\. Downsample inline images/)
  })
})

describe('HtmlPageModel.parse', () => {
  it('defaults the theme and height and counts UTF-8 bytes', () => {
    const parsed = HtmlPageModel.parse({ title: ' Café ', html: '<p>é</p>' })
    expect(parsed).toEqual({ ok: true, bytes: 9, page: { title: 'Café', html: '<p>é</p>', height: HtmlPageLimits.defaultHeight, theme: 'auto' } })
  })

  it('names every invalid field', () => {
    const parsed = HtmlPageModel.parse({ title: '', html: '', theme: 'sepia' })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('title: title is empty')
    expect(parsed.error).toContain('html: html is empty')
    expect(parsed.error).toContain('theme:')
  })
})
