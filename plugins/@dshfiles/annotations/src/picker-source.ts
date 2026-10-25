export const PICK_BINDING = 'dshAnnotationPick'

/**
 * Injected into a page over CDP. It mirrors the extension's rules: bounded
 * descriptor, no form values, no private subtree, and one binding call back.
 */
export const PICK_SOURCE = String.raw`
(() => {
  const BINDING = '__DSH_BINDING__'
  if (window.__dshAnnotationPicking === true) return
  window.__dshAnnotationPicking = true
  const SAFE_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-component', 'role', 'aria-label', 'aria-describedby']
  const SAFE_STYLES = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'margin', 'padding', 'border-radius', 'gap', 'z-index', 'overflow', 'flex-direction', 'align-items', 'justify-content', 'width']
  const SENSITIVE = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']
  const DECORATION = ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'use', 'img', 'picture', 'source', 'br']
  const INTERACTIVE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, label'
  const SAFE_ID = /^[A-Za-z0-9_-]+$/
  const send = (payload) => { try { window[BINDING](JSON.stringify(payload)) } catch (error) {} }
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
    const interactive = element.closest(INTERACTIVE)
    if (interactive !== null && privateAncestor(interactive) === null && !sensitive(interactive)) return interactive
    for (let current = element, depth = 0; current !== null && depth < 6; depth += 1, current = current.parentElement) {
      if (!sensitive(current) && DECORATION.indexOf(current.tagName.toLowerCase()) < 0) return current
    }
    return null
  }
  const escapeCss = (value) => (window.CSS && window.CSS.escape ? window.CSS.escape(value) : value.replace(/([^A-Za-z0-9_-])/g, '\\$1'))
  const segment = (element) => {
    const tag = element.tagName.toLowerCase()
    const classes = Array.prototype.slice.call(element.classList, 0, 2).map((name) => escapeCss(name.slice(0, 60))).filter((name) => name.length > 0)
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
    const label = element.getAttribute('aria-label') || element.getAttribute('title')
    const text = String(label || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240)
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
        surface: 'external',
        url: (location.origin + location.pathname).slice(0, 400),
        selector: selectorOf(element),
        tag: element.tagName.toLowerCase(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      },
      text.length === 0 ? {} : { text },
      Object.keys(attributes).length === 0 ? {} : { attributes },
      Object.keys(styles).length === 0 ? {} : { styles },
    )
  }
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;pointer-events:none'
  const box = document.createElement('div')
  box.style.cssText = 'position:absolute;border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:2px;display:none'
  const hint = document.createElement('div')
  hint.textContent = 'Click an element to send it to DSH · Esc to cancel'
  hint.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;font:12px/1.4 system-ui;padding:4px 10px;border-radius:999px'
  overlay.append(box, hint)
  document.documentElement.append(overlay)
  const finish = () => {
    window.__dshAnnotationPicking = false
    overlay.remove()
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    document.body.style.cursor = ''
  }
  const onMove = (event) => {
    const element = pickable(event.target)
    if (element === null) { box.style.display = 'none'; return }
    const rect = element.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = rect.x + 'px'
    box.style.top = rect.y + 'px'
    box.style.width = rect.width + 'px'
    box.style.height = rect.height + 'px'
  }
  const onClick = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = pickable(event.target)
    if (element === null) return
    const target = targetOf(element)
    const point = { x: Math.round(event.clientX), y: Math.round(event.clientY) }
    finish()
    send({ ok: true, target, point })
  }
  const onKey = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    finish()
    send({ ok: false })
  }
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  document.body.style.cursor = 'crosshair'
})()
`
