const mode = new URLSearchParams(location.search).get('mode') || 'current'
const $ = id => document.getElementById(id)
const fixture = name => fetch(`/fixture/src/${name}`).then(r => r.text())
const marks = (globalThis.marks = {})
const mark = k => (marks[k] ??= performance.now())
const afterTwoFrames = f => requestAnimationFrame(() => requestAnimationFrame(f))
let engine
let editor
let core
let ws
let active = 'sample.ts'
let original
let saveResult
const persist = async () => {
  const value = get()
  saveResult = await fetch(`/save/${active}`, { method: 'POST', body: value }).then(r => r.ok)
}
const get = () => (engine ? engine.snapshot(active)?.text : editor?.getModel()?.getValue())
globalThis.check = { get, original: () => original, saved: () => saveResult, current: () => active }
let programs
const currentDoc = async name => ({ id: name, path: `/fixture/src/${name}`, text: await fixture(name) })
$('first').onclick = async () => {
  $('first').disabled = true
  mark('opened')
  // Deliberately parallel fixture fetch + engine import, not DSH's document-ready gate.
  const start = fixture(active)
  const observer = new MutationObserver(() => {
    if (document.querySelector('.monaco-editor-prerender .view-line, .monaco-editor-prerender pre, .monaco-editor .view-line'))
      afterTwoFrames(() => mark('sourceDom'))
    if (document.querySelector('.monaco-editor .view-line span[class^=mtk]')) afterTwoFrames(() => mark('highlighted'))
  })
  observer.observe($('container'), { childList: true, subtree: true, attributes: true })
  if (mode === 'current') {
    const loading = import('/dist/current.js')
    original = await start
    engine = (await loading).monacoEngine.create($('container'), {
      dark: true,
      onSave: persist,
      onDirtyChange: (_id, dirty) => {
        if (dirty) mark('accepted')
      },
    })
    engine.show({ id: active, path: `/fixture/src/${active}`, text: original })
    engine.focus()
  } else {
    const entry = `/modern/${mode === 'modern-core' ? 'core' : 'index'}.mjs`
    const loading = import(/* @vite-ignore */ entry)
    original = await start
    const api = await loading
    ws = new api.Workspace({ name: `issue-137-${crypto.randomUUID()}`, entryFile: `/${active}` })
    await ws.fs.writeFile(`/${active}`, original)
    programs = mode === 'modern-core' ? await Promise.all([fetch('/themes/vitesse-dark.json').then(r => r.json())]) : []
    api.lazy({ workspace: ws, cdn: location.origin, ...(programs.length ? { theme: programs[0] } : { theme: 'vitesse-dark' }) })
    const element = document.createElement('monaco-editor')
    element.setAttribute('fontSize', '12')
    element.setAttribute('theme', 'vitesse-dark')
    element.setAttribute('automaticLayout', 'true')
    element.setAttribute('minimap', '{"enabled":false}')
    $('container').append(element)
    while (!document.querySelector('.monaco-editor .view-line')) await new Promise(requestAnimationFrame)
    const coreUrl = JSON.parse(document.querySelector('script[type=importmap]').textContent).imports['modern-monaco/editor-core']
    core = await import(/* @vite-ignore */ coreUrl)
    editor = core.editor.getEditors()[0]
    editor.addCommand(core.KeyMod.CtrlCmd | core.KeyCode.KeyS, persist)
    editor.onDidChangeModelContent(() => mark('accepted'))
    editor.focus()
  }
  mark('focus')
  $('second').disabled = $('reveal').disabled = $('save').disabled = false
}
$('reveal').onclick = () => {
  if (engine) {
    engine.reveal(active, 40)
    engine.focus()
  } else {
    editor.revealLineInCenter(40)
    editor.setPosition({ lineNumber: 40, column: 1 })
    editor.focus()
  }
}
$('save').onclick = persist
$('second').onclick = async () => {
  active = 'second.ts'
  const file = await currentDoc(active)
  if (engine) {
    engine.show(file)
    engine.focus()
  } else {
    await ws.fs.writeFile(`/${active}`, file.text)
    await ws.openTextDocument(`/${active}`, undefined, editor)
    editor.focus()
  }
}
mark('shell')
