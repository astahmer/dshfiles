const STORAGE_DEFAULTS = { endpoint: 'http://127.0.0.1:3080/api/dshfiles-annotations/ingest', token: '' }

const readSettings = async () => ({ ...STORAGE_DEFAULTS, ...(await chrome.storage.local.get(['endpoint', 'token'])) })

const post = async ({ endpoint, token, drafts }) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ drafts }),
  })
  if (!response.ok) throw new Error(`DSH refused the annotation (${response.status})`)
  return await response.json()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind === 'annotations:submit') {
    void (async () => {
      try {
        const settings = await readSettings()
        if (settings.token.length === 0) throw new Error('Paste the token from DSH first.')
        sendResponse({ ok: true, result: await post({ endpoint: settings.endpoint, token: settings.token, drafts: message.drafts }) })
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
    return true
  }
  if (message?.kind === 'annotations:start-pick') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id === undefined) throw new Error('No active tab.')
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: startPicker })
        sendResponse({ ok: true })
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
    return true
  }
  return false
})

/**
 * Runs inside the annotated page. It is self-contained because the service worker cannot
 * import into a page context. Every capture is bounded and refuses form values and any
 * `[data-private]` subtree, matching what the DSH side would capture for its own UI.
 */
function startPicker() {
  if (window.__dshAnnotationsPicking === true) return
  window.__dshAnnotationsPicking = true
  const SAFE_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-component', 'role', 'aria-label', 'aria-describedby']
  const SAFE_STYLES = [
    'display',
    'position',
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'margin',
    'padding',
    'border-radius',
    'gap',
    'z-index',
    'overflow',
    'flex-direction',
    'align-items',
    'justify-content',
    'width',
  ]
  const SENSITIVE = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']
  const SAFE_ID = /^[A-Za-z0-9_-]+$/

  const privateAncestor = element => {
    for (let current = element, depth = 0; current !== null && depth < 16; depth += 1, current = current.parentElement) {
      if (current.hasAttribute('data-private') || current.hasAttribute('data-visual-edit-private')) return current
    }
    return null
  }
  const sensitive = element => {
    if (SENSITIVE.includes(element.tagName)) return true
    const editable = element.getAttribute('contenteditable')
    return editable !== null && ['true', 'plaintext-only', ''].includes(editable.trim().toLowerCase())
  }
  const pickable = element => {
    if (privateAncestor(element) !== null) return null
    for (let current = element, depth = 0; current !== null && depth < 6; depth += 1, current = current.parentElement) {
      if (!sensitive(current)) return current
    }
    return null
  }
  const segment = element => {
    const tag = element.tagName.toLowerCase()
    const classes = Array.from(element.classList)
      .slice(0, 2)
      .map(name => name.replace(/[^A-Za-z0-9_-]/g, '_'))
      .filter(name => name.length > 0)
    return classes.length === 0 ? tag : `${tag}.${classes.join('.')}`
  }
  const selectorOf = element => {
    const own = element.getAttribute('id')
    if (own !== null && SAFE_ID.test(own)) return `#${own}`
    const parts = []
    for (let current = element, depth = 0; current !== null && current !== document.body && depth < 4; depth += 1, current = current.parentElement) {
      const id = current.getAttribute('id')
      if (id !== null && SAFE_ID.test(id)) {
        parts.unshift(`#${id}`)
        break
      }
      parts.unshift(segment(current))
    }
    return (parts.length === 0 ? element.tagName.toLowerCase() : parts.join(' > ')).slice(0, 600)
  }
  const targetOf = element => {
    const rect = element.getBoundingClientRect()
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
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
    return {
      surface: 'external',
      url: `${window.location.origin}${window.location.pathname}`.slice(0, 400),
      selector: selectorOf(element),
      tag: element.tagName.toLowerCase(),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      ...(text.length === 0 ? {} : { text }),
      ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
      ...(Object.keys(styles).length === 0 ? {} : { styles }),
    }
  }

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;pointer-events:none'
  const outline = document.createElement('div')
  outline.style.cssText = 'position:absolute;border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:2px;display:none'
  const hint = document.createElement('div')
  hint.textContent = 'Click an element to send it to DSH · Esc to cancel'
  hint.style.cssText =
    'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;font:12px/1.4 system-ui;padding:4px 10px;border-radius:999px'
  overlay.append(outline, hint)
  document.documentElement.append(overlay)

  const finish = () => {
    window.__dshAnnotationsPicking = false
    overlay.remove()
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    document.body.style.cursor = ''
  }
  const onMove = event => {
    const element = pickable(event.target)
    if (element === null) {
      outline.style.display = 'none'
      return
    }
    const rect = element.getBoundingClientRect()
    outline.style.display = 'block'
    outline.style.left = `${rect.x}px`
    outline.style.top = `${rect.y}px`
    outline.style.width = `${rect.width}px`
    outline.style.height = `${rect.height}px`
  }
  const onClick = event => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = pickable(event.target)
    if (element === null) return
    const note = window.prompt('What is wrong or what should change?')
    if (note === null) {
      finish()
      return
    }
    finish()
    void chrome.runtime.sendMessage({
      kind: 'annotations:submit',
      drafts: [{ kind: 'element', target: targetOf(element), note: note.slice(0, 2000) }],
    })
  }
  const onKey = event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    finish()
  }
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  document.body.style.cursor = 'crosshair'
}
