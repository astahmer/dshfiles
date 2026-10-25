const INSPECTOR = String.raw`
(() => {
  const NONCE = '__DSH_NONCE__'
  const SAFE_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-component', 'role', 'aria-label', 'aria-describedby']
  const SAFE_STYLES = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'margin', 'padding', 'border-radius', 'gap', 'z-index', 'overflow', 'flex-direction', 'align-items', 'justify-content', 'width']
  const SENSITIVE = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']
  const SAFE_ID = /^[A-Za-z0-9_-]+$/
  const post = (message) => parent.postMessage(Object.assign({ __dshAnnotations: NONCE }, message), '*')
  const privateAncestor = (element) => {
    for (let current = element, depth = 0; current !== null && depth < 16; depth += 1, current = current.parentElement) {
      if (current.hasAttribute('data-private') || current.hasAttribute('data-visual-edit-private')) return current
    }
    return null
  }
  const sensitive = (element) => {
    if (SENSITIVE.indexOf(element.tagName) >= 0) return true
    const editable = element.getAttribute('contenteditable')
    return editable !== null && ['true', 'plaintext-only', ''].indexOf(editable.trim().toLowerCase()) >= 0
  }
  const pickable = (element) => {
    if (privateAncestor(element) !== null) return null
    for (let current = element, depth = 0; current !== null && depth < 6; depth += 1, current = current.parentElement) {
      if (!sensitive(current)) return current
    }
    return null
  }
  const segment = (element) => {
    const tag = element.tagName.toLowerCase()
    const classes = Array.prototype.slice.call(element.classList, 0, 2).map((name) => name.replace(/[^A-Za-z0-9_-]/g, '_')).filter((name) => name.length > 0)
    return classes.length === 0 ? tag : tag + '.' + classes.join('.')
  }
  const selectorOf = (element) => {
    const own = element.getAttribute('id')
    if (own !== null && SAFE_ID.test(own)) return '#' + own
    const parts = []
    for (let current = element, depth = 0; current !== null && current !== document.body && depth < 4; depth += 1, current = current.parentElement) {
      const id = current.getAttribute('id')
      if (id !== null && SAFE_ID.test(id)) { parts.unshift('#' + id); break }
      parts.unshift(segment(current))
    }
    const joined = parts.join(' > ')
    return (joined.length === 0 ? element.tagName.toLowerCase() : joined).slice(0, 600)
  }
  const targetOf = (element) => {
    const rect = element.getBoundingClientRect()
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    const attributes = {}
    for (const name of SAFE_ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (value !== null && value.trim().length > 0) attributes[name] = value.trim().slice(0, 120)
      if (Object.keys(attributes).length >= 8) break
    }
    const computed = window.getComputedStyle(element)
    const styles = {}
    for (const name of SAFE_STYLES) {
      const value = computed.getPropertyValue(name).trim()
      if (value.length > 0) styles[name] = value.slice(0, 120)
      if (Object.keys(styles).length >= 16) break
    }
    return Object.assign(
      {
        surface: 'preview',
        url: location.href,
        selector: selectorOf(element),
        tag: element.tagName.toLowerCase(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      },
      text.length === 0 ? {} : { text },
      Object.keys(attributes).length === 0 ? {} : { attributes },
      Object.keys(styles).length === 0 ? {} : { styles },
    )
  }
  const outline = document.createElement('div')
  outline.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;pointer-events:none'
  const box = document.createElement('div')
  box.style.cssText = 'position:absolute;border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:2px;display:none'
  const hint = document.createElement('div')
  hint.textContent = 'Click an element to send it to DSH'
  hint.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;font:12px/1.4 system-ui;padding:4px 10px;border-radius:999px'
  outline.append(box, hint)
  document.documentElement.append(outline)
  document.addEventListener('pointermove', (event) => {
    const element = pickable(event.target)
    if (element === null) { box.style.display = 'none'; return }
    const rect = element.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = rect.x + 'px'
    box.style.top = rect.y + 'px'
    box.style.width = rect.width + 'px'
    box.style.height = rect.height + 'px'
  }, true)
  document.addEventListener('click', (event) => {
    const element = pickable(event.target)
    if (element === null) return
    event.preventDefault()
    event.stopImmediatePropagation()
    post({ kind: 'pick', target: targetOf(element) })
  }, true)
  post({ kind: 'ready' })
})()
`

const NONCE_PLACEHOLDER = '__DSH_NONCE__'

const stripScripts = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')

/**
 * Best-effort preview: the page's own scripts and inline handlers are removed, and the
 * frame is sandboxed without `allow-same-origin`, so the visited content cannot reach
 * DSH's DOM. The inspector is the only script we put back.
 */
export const buildPreviewDocument = ({ html, nonce }: { readonly html: string; readonly nonce: string }): string => {
  const clean = stripScripts(html)
  const inspector = `<script>${INSPECTOR.replaceAll(NONCE_PLACEHOLDER, nonce)}</script>`
  if (/<\/body\s*>/i.test(clean)) return clean.replace(/<\/body\s*>/i, `${inspector}</body>`)
  return `${clean}${inspector}`
}
