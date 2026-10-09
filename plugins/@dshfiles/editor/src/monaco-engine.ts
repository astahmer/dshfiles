import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/register.all'
import 'monaco-editor/languages/features/json/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker&inline'
import monacoCss from 'virtual:dshfiles-monaco-css'
import type { CodeEditorEngine, CodeEditorHandle, EditorDocument } from './code-editor.js'

export const MONACO_STYLE_ATTRIBUTE = 'data-dshfiles-monaco'

const LIGHT_THEME = 'dshfiles-light'
const DARK_THEME = 'dshfiles-dark'
const HEX_COLOR = /^#[0-9a-f]{6}$/i

let environmentReady = false
// Several surfaces (right panel, workbench) may show one file: they share its model, disposed with the last one.
const modelUsers = new Map<monaco.editor.ITextModel, number>()
const releaseModel = (model: monaco.editor.ITextModel): void => {
  const users = (modelUsers.get(model) ?? 1) - 1
  if (users > 0) {
    modelUsers.set(model, users)
    return
  }
  modelUsers.delete(model)
  model.dispose()
}

/** Runs on the first editor only: styles, workers and themes cost nothing until a file is opened. */
const prepareEnvironment = (): void => {
  if (environmentReady) return
  environmentReady = true
  if (document.querySelector(`style[${MONACO_STYLE_ATTRIBUTE}]`) === null) {
    const style = document.createElement('style')
    style.setAttribute(MONACO_STYLE_ATTRIBUTE, '')
    style.textContent = monacoCss
    document.head.appendChild(style)
  }
  // dshx forbids worker files, so each worker starts from a Blob URL of its inlined source.
  Reflect.set(globalThis, 'MonacoEnvironment', {
    getWorker: (_moduleId: string, label: string): Worker => (label === 'json' ? new JsonWorker({ name: label }) : new EditorWorker({ name: label })),
  })
  const hostColor = (name: string): Record<string, string> => {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim()
    return HEX_COLOR.test(value) ? { 'editor.background': value, 'editorGutter.background': value, 'minimap.background': value } : {}
  }
  monaco.editor.defineTheme(LIGHT_THEME, { base: 'vs', inherit: true, rules: [], colors: hostColor('--dsw-alias-bg-base') })
  monaco.editor.defineTheme(DARK_THEME, { base: 'vs-dark', inherit: true, rules: [], colors: hostColor('--dsw-alias-bg-base') })
}

// The path keeps Monaco's extension-based language detection; the query keeps one model per session and path.
const documentUri = (document: EditorDocument): monaco.Uri => monaco.Uri.from({ scheme: 'dshfiles', path: document.path, query: document.id })

export const monacoEngine: CodeEditorEngine = {
  name: 'monaco',
  create: (container, options) => {
    prepareEnvironment()
    const models = new Map<string, monaco.editor.ITextModel>()
    const savedVersions = new Map<string, number>()
    const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()
    const reportedDirty = new Map<string, boolean>()
    let currentId: string | null = null

    const editor = monaco.editor.create(container, {
      automaticLayout: true,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--ds-font-family-code').trim() || undefined,
      fontSize: 12,
      minimap: { enabled: false },
      model: null,
      scrollBeyondLastLine: false,
      theme: options.dark ? DARK_THEME : LIGHT_THEME,
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => options.onSave())

    const isDirty = (documentId: string): boolean => {
      const model = models.get(documentId)
      return model !== undefined && model.getAlternativeVersionId() !== savedVersions.get(documentId)
    }
    const report = (documentId: string): void => {
      const dirty = isDirty(documentId)
      if (reportedDirty.get(documentId) === dirty) return
      reportedDirty.set(documentId, dirty)
      options.onDirtyChange(documentId, dirty)
    }

    const handle: CodeEditorHandle = {
      show: document => {
        if (currentId === document.id) return
        if (currentId !== null) viewStates.set(currentId, editor.saveViewState())
        let model = models.get(document.id)
        if (model === undefined) {
          const uri = documentUri(document)
          model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(document.text, undefined, uri)
          modelUsers.set(model, (modelUsers.get(model) ?? 0) + 1)
          models.set(document.id, model)
          savedVersions.set(document.id, model.getAlternativeVersionId())
          model.onDidChangeContent(() => report(document.id))
        }
        currentId = document.id
        editor.setModel(model)
        const viewState = viewStates.get(document.id)
        if (viewState !== undefined && viewState !== null) editor.restoreViewState(viewState)
      },
      reset: document => {
        const model = models.get(document.id)
        if (model === undefined) return
        model.setValue(document.text)
        savedVersions.set(document.id, model.getAlternativeVersionId())
        report(document.id)
      },
      close: documentId => {
        const model = models.get(documentId)
        if (model !== undefined) releaseModel(model)
        models.delete(documentId)
        savedVersions.delete(documentId)
        viewStates.delete(documentId)
        reportedDirty.delete(documentId)
        if (currentId === documentId) {
          currentId = null
          editor.setModel(null)
        }
      },
      reveal: (documentId, line) => {
        if (currentId !== documentId) return
        editor.revealLineInCenter(line)
        editor.setPosition({ lineNumber: line, column: 1 })
      },
      snapshot: documentId => {
        const model = models.get(documentId)
        return model === undefined ? undefined : { text: model.getValue(), version: model.getAlternativeVersionId() }
      },
      isDirty,
      markSaved: (documentId, version) => {
        if (!models.has(documentId)) return
        savedVersions.set(documentId, version)
        report(documentId)
      },
      setDark: dark => monaco.editor.setTheme(dark ? DARK_THEME : LIGHT_THEME),
      focus: () => editor.focus(),
      dispose: () => {
        editor.dispose()
        for (const model of models.values()) releaseModel(model)
        models.clear()
      },
    }
    return handle
  },
}
