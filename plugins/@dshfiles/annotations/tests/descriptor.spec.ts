import { describe, expect, it } from 'vitest'
import { describeTarget, elementSelector, matchesTarget, pickableElement } from '../src/descriptor.js'

const mount = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

describe('elementSelector', () => {
  it('uses the id when it is a plain identifier', () => {
    const host = mount('<div id="composer-shell"><button>x</button></div>')
    const button = host.querySelector('button')
    expect(button === null ? '' : elementSelector(button)).toBe('#composer-shell > button')
  })

  it('builds a bounded path with two classes per level', () => {
    const host = mount('<div class="a b c"><span class="d e f"></span></div>')
    const span = host.querySelector('span')
    expect(span === null ? '' : elementSelector(span)).toBe('div > div.a.b > span.d.e')
  })

  it('escapes a class so the selector still queries the element', () => {
    const host = mount('<div class="dshx:inline-flex dshx:items-center"><button>x</button></div>')
    const button = host.querySelector('button')
    if (button === null) throw new Error('fixture missing')
    const selector = elementSelector(button)
    expect(selector).toContain('dshx\\:inline-flex')
    expect(document.querySelector(selector)).toBe(button)
  })

  it('skips an id that is not a plain identifier', () => {
    const host = mount('<div id="weird id"><p>x</p></div>')
    const paragraph = host.querySelector('p')
    expect(paragraph === null ? '' : elementSelector(paragraph)).not.toContain('#')
  })
})

describe('describeTarget', () => {
  it('captures a bounded descriptor', () => {
    const host = mount('<button class="primary" data-testid="rebase" aria-label="Rebase">Rebase thread</button>')
    const button = host.querySelector('button')
    if (button === null) throw new Error('fixture missing')
    const target = describeTarget({ element: button, surface: 'dsh', url: 'http://127.0.0.1:3080/thread/1?token=x' })
    expect(target).not.toBeNull()
    expect(target?.surface).toBe('dsh')
    expect(target?.url).toBe('http://127.0.0.1:3080/thread/1')
    expect(target?.selector).toContain('button.primary')
    expect(target?.tag).toBe('button')
    expect(target?.text).toBe('Rebase')
    expect(target?.attributes?.['data-testid']).toBe('rebase')
    expect(target?.styles?.['display']).toBeDefined()
  })

  it('refuses an input value', () => {
    const host = mount('<input value="hunter2">')
    const input = host.querySelector('input')
    if (input === null) throw new Error('fixture missing')
    expect(describeTarget({ element: input, surface: 'dsh', url: 'http://127.0.0.1:3080/' })).toBeNull()
  })

  it('refuses an element under data-private', () => {
    const host = mount('<section data-private><p>secret</p></section>')
    const paragraph = host.querySelector('p')
    if (paragraph === null) throw new Error('fixture missing')
    expect(describeTarget({ element: paragraph, surface: 'dsh', url: 'http://127.0.0.1:3080/' })).toBeNull()
  })
})

describe('matchesTarget', () => {
  it('keeps matching when only the badge text changes', () => {
    const host = mount('<button aria-label="Annotate an element"><svg></svg><span>1</span></button>')
    const button = host.querySelector('button')
    if (button === null) throw new Error('fixture missing')
    const target = describeTarget({ element: button, surface: 'dsh', url: 'http://127.0.0.1:3080/' })
    if (target === null) throw new Error('target missing')
    expect(target.text).toBe('Annotate an element')
    expect(matchesTarget({ element: button, target })).toBe(true)
  })

  it('matches on tag and a stable text prefix', () => {
    const host = mount('<button>Rebase thread</button>')
    const button = host.querySelector('button')
    if (button === null) throw new Error('fixture missing')
    const target = describeTarget({ element: button, surface: 'dsh', url: 'http://127.0.0.1:3080/' })
    if (target === null) throw new Error('target missing')
    expect(matchesTarget({ element: button, target })).toBe(true)
    button.textContent = 'Something else entirely'
    expect(matchesTarget({ element: button, target })).toBe(false)
  })
})

describe('pickableElement', () => {
  it('bubbles from a form control to its container', () => {
    const host = mount('<form class="composer"><input value="x"></form>')
    const input = host.querySelector('input')
    if (input === null) throw new Error('fixture missing')
    expect(pickableElement(input)?.tagName.toLowerCase()).toBe('form')
  })

  it('picks the control around a decoration', () => {
    const host = mount('<button aria-label="Rebase"><span><svg><path d="M0 0"></path></svg></span></button>')
    const path = host.querySelector('path')
    if (path === null) throw new Error('fixture missing')
    expect(pickableElement(path)?.tagName.toLowerCase()).toBe('button')
  })

  it('refuses a private subtree instead of bubbling past it', () => {
    const host = mount('<section data-private><input value="x"></section>')
    const input = host.querySelector('input')
    if (input === null) throw new Error('fixture missing')
    expect(pickableElement(input)).toBeNull()
  })
})
