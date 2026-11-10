import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { PlusIcon } from '@dshfiles/plugin-ui/icons'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { useReducer, useState, useSyncExternalStore } from 'react'
import type { ShellTranslate } from '../native/locales.js'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue, type SettingField } from './schema-model.js'
import { SettingsDocument, type DocumentDiagnostic } from './settings-document.js'

/**
 * One namespace's overrides as JSON text, beside the form. Clean, the text follows the stored overrides; the first
 * keystroke pins the revision and overrides it started from, so a save sends only the fields this draft changed, fenced
 * by that revision. A refused or stale save keeps the draft. The defaults and effective views are read-only.
 */
type Draft = { readonly text: string; readonly revision: number | undefined; readonly before: JsonValue | undefined }
type EditorState =
  | { readonly kind: 'following' }
  | ({ readonly kind: 'editing' } & Draft)
  | ({ readonly kind: 'saving'; readonly token: number } & Draft)
  | ({ readonly kind: 'refused' } & Draft)

type EditorEvent =
  | { readonly type: 'edit'; readonly text: string; readonly revision: number | undefined; readonly before: JsonValue | undefined }
  | { readonly type: 'save'; readonly token: number }
  | { readonly type: 'settled'; readonly token: number; readonly accepted: boolean }
  | { readonly type: 'discard' }

const reduce = (state: EditorState, event: EditorEvent): EditorState => {
  switch (event.type) {
    case 'edit':
      if (state.kind === 'saving') return state
      if (state.kind === 'following') return { kind: 'editing', text: event.text, revision: event.revision, before: event.before }
      return { ...state, kind: 'editing', text: event.text }
    case 'save':
      return state.kind === 'editing' || state.kind === 'refused' ? { ...state, kind: 'saving', token: event.token } : state
    case 'settled':
      if (state.kind !== 'saving' || state.token !== event.token) return state
      return event.accepted ? { kind: 'following' } : { kind: 'refused', text: state.text, revision: state.revision, before: state.before }
    case 'discard':
      return state.kind === 'saving' ? state : { kind: 'following' }
  }
}

const useSnapshot = (form: ConfigForm<unknown>): ConfigFormSnapshot<unknown> =>
  useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
  )

const decodeJsonValue = Schema.decodeUnknownOption(jsonValueSchema)

const diagnosticText = (diagnostic: DocumentDiagnostic, t: ShellTranslate): string => {
  const message = ((): string => {
    switch (diagnostic.code) {
      case 'parse':
        return t('json.diag.parse', { detail: diagnostic.detail ?? '' })
      case 'not-object':
        return t('json.diag.notObject')
      case 'unknown-key':
        return t('json.diag.unknownKey', { path: diagnostic.path.join('.') })
      case 'type':
        return t('json.diag.type', { path: diagnostic.path.join('.'), expected: diagnostic.expected ?? '' })
    }
  })()
  return diagnostic.line === undefined ? message : `${t('json.line', { line: diagnostic.line })} ${message}`
}

const ReadOnlyDocument = (props: { readonly label: string; readonly value: JsonValue | undefined }): JSX.Element => (
  <pre
    aria-label={props.label}
    className="dshx:m-0 dshx:max-h-[420px] dshx:overflow-auto dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/40 dshx:p-3 dshx:font-mono dshx:text-xs dshx:whitespace-pre"
    tabIndex={0}
  >
    {SettingsDocument.format(props.value)}
  </pre>
)

const InsertSetting = (props: {
  readonly fields: readonly SettingField[]
  readonly present: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onPick: (field: SettingField) => void
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  const missing = props.fields.filter(field => !SettingsSchemaModel.hasValueAt(props.present, field.path))
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button disabled={props.disabled} size="sm" type="button" variant="outline">
          <PlusIcon />
          {props.t('json.insert')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="dshx:w-80 dshx:max-w-[calc(100vw-2rem)] dshx:p-0">
        <Command>
          <CommandInput placeholder={props.t('json.insertSearch')} />
          <CommandList>
            <CommandEmpty>{props.t('json.insertNone')}</CommandEmpty>
            <CommandGroup>
              {missing.map(field => (
                <CommandItem
                  key={field.path.join('.')}
                  onSelect={() => {
                    setOpen(false)
                    props.onPick(field)
                  }}
                  value={`${field.path.join('.')} ${field.title} ${field.description}`}
                >
                  <span className="dshx:flex dshx:min-w-0 dshx:flex-col">
                    <span className="dshx:truncate">{field.title}</span>
                    <code className="dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{field.path.join('.')}</code>
                    {field.description !== '' && <span className="dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{field.description}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export const SettingsJsonEditor = (props: {
  readonly namespace: string
  readonly form: ConfigForm<unknown>
  readonly fields: readonly SettingField[]
  readonly t: ShellTranslate
}): JSX.Element => {
  const { t } = props
  const snapshot = useSnapshot(props.form)
  const [state, send] = useReducer(reduce, { kind: 'following' })
  const [nextToken, setNextToken] = useState(0)
  const user = Option.getOrUndefined(decodeJsonValue(snapshot.user))
  const base = Option.getOrUndefined(decodeJsonValue(snapshot.base))
  const draft = state.kind === 'following' ? undefined : state
  const text = draft?.text ?? SettingsDocument.format(user)
  const parsed = SettingsDocument.parse({ text, fields: props.fields })
  const writable = snapshot.status === 'ready' && snapshot.writable
  const stale = draft !== undefined && state.kind !== 'saving' && draft.revision !== snapshot.revision
  const blocking = parsed.diagnostics.length > 0
  const edit = (next: string): void => send({ type: 'edit', text: next, revision: snapshot.revision, before: user })

  const save = (fence: number | undefined): void => {
    if (draft === undefined || !parsed.ok || blocking) return
    const ops = SettingsDocument.operations({ fields: props.fields, before: draft.before, after: parsed.value })
    const token = nextToken + 1
    setNextToken(token)
    if (ops.length === 0) {
      send({ type: 'discard' })
      return
    }
    send({ type: 'save', token })
    void props.form.mutate(ops, fence).then(
      accepted => send({ type: 'settled', token, accepted }),
      () => send({ type: 'settled', token, accepted: false }),
    )
  }

  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3" data-settings-json={props.namespace}>
      <Tabs defaultValue="overrides">
        <TabsList>
          <TabsTrigger value="overrides">{t('json.overrides')}</TabsTrigger>
          <TabsTrigger value="defaults">{t('json.defaults')}</TabsTrigger>
          <TabsTrigger value="effective">{t('json.effective')}</TabsTrigger>
        </TabsList>
        <TabsContent className="dshx:flex dshx:flex-col dshx:gap-2" value="overrides">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <InsertSetting
              disabled={!writable || !parsed.ok || state.kind === 'saving'}
              fields={props.fields}
              onPick={field => {
                const inherited = SettingsSchemaModel.hasValueAt(base, field.path) ? SettingsSchemaModel.valueAt(base, field.path) : field.defaultValue
                const next = SettingsDocument.withField({ text, field, value: inherited ?? SettingsDocument.placeholderFor(field) })
                if (next !== undefined) edit(next)
              }}
              present={parsed.ok ? parsed.value : undefined}
              t={t}
            />
            {draft !== undefined && <Badge variant="outline">{state.kind === 'saving' ? t('json.saving') : t('json.unsaved')}</Badge>}
          </div>
          <Textarea
            aria-describedby={`settings-json-diagnostics-${props.namespace}`}
            aria-invalid={blocking}
            aria-label={t('json.editorLabel', { namespace: props.namespace })}
            autoCapitalize="off"
            autoCorrect="off"
            className="dshx:min-h-64 dshx:w-full dshx:resize-y dshx:font-mono! dshx:text-xs"
            disabled={!writable || state.kind === 'saving'}
            onChange={event => edit(event.currentTarget.value)}
            spellCheck={false}
            value={text}
          />
          <ul aria-live="polite" className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:gap-1 dshx:p-0" id={`settings-json-diagnostics-${props.namespace}`}>
            {parsed.diagnostics.map(diagnostic => (
              <li className="dshx:text-xs dshx:text-destructive" data-diagnostic={diagnostic.code} key={`${diagnostic.code}:${diagnostic.path.join('.')}`}>
                {diagnosticText(diagnostic, t)}
              </li>
            ))}
          </ul>
          {stale && (
            <Alert variant="warning">
              <AlertDescription className="dshx:flex dshx:flex-col dshx:gap-2">
                <span>{t('json.conflict')}</span>
                <span className="dshx:flex dshx:flex-wrap dshx:gap-2">
                  <Button onClick={() => send({ type: 'discard' })} size="sm" type="button" variant="outline">
                    {t('json.reload')}
                  </Button>
                  <Button disabled={blocking} onClick={() => save(snapshot.revision)} size="sm" type="button" variant="outline">
                    {t('json.saveOver')}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          )}
          {state.kind === 'refused' && !stale && (
            <Alert variant="destructive">
              <AlertDescription>{t('json.refused')}</AlertDescription>
            </Alert>
          )}
          <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
            <Button disabled={draft === undefined || blocking || stale || state.kind === 'saving'} onClick={() => save(draft?.revision)} size="sm" type="button">
              {t('json.save')}
            </Button>
            <Button disabled={draft === undefined || state.kind === 'saving'} onClick={() => send({ type: 'discard' })} size="sm" type="button" variant="ghost">
              {t('json.discard')}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="defaults">
          <ReadOnlyDocument label={t('json.defaults')} value={SettingsDocument.inheritedDocument({ fields: props.fields, base })} />
        </TabsContent>
        <TabsContent value="effective">
          <ReadOnlyDocument label={t('json.effective')} value={Option.getOrUndefined(decodeJsonValue(snapshot.value))} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
