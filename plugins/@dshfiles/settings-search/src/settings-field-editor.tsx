import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useAppForm, useStore } from '@dshfiles/plugin-ui/form'
import { PluginQueryProvider, errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import {
  formatSettingsDraft,
  hasSettingsPath,
  parseSettingsDraft,
  readSettingsPath,
  schemaNodeAtPath,
  setOperationForSettingsTarget,
  settingsEditorKind,
  unsetOperationForSettingsTarget,
} from './settings-editor-model.js'
import { settingsChoiceOptions, type SettingsSearchNamespace, type SettingsSearchResult } from './settings-index.js'
import type { SettingsSearchTranslate } from './locales.js'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ChevronLeftIcon, InfoIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'

export interface SettingsFieldEditorProps {
  readonly result: SettingsSearchResult
  readonly namespace: SettingsSearchNamespace
  readonly form: ConfigForm<unknown>
  readonly onBack: () => void
  readonly t: SettingsSearchTranslate
}

const snapshotFor = (form: ConfigForm<unknown>): ConfigFormSnapshot<unknown> => form.getSnapshot()

const SettingsFieldEditorContent = (props: SettingsFieldEditorProps): JSX.Element => {
  const form = props.form
  const t = props.t
  const snapshot = useSyncExternalStore(
    useCallback(listener => form.subscribe(listener), [form]),
    useCallback(() => snapshotFor(form), [form]),
    useCallback(() => snapshotFor(form), [form]),
  )
  const path = props.result.target.fieldPath
  const schema = schemaNodeAtPath(props.namespace.schema, path)
  const choices = useMemo(
    () => settingsChoiceOptions(schemaNodeAtPath(props.namespace.schema, props.result.target.fieldPath)),
    [props.namespace.schema, props.result.id],
  )
  const value = readSettingsPath(snapshot.value, path)
  const kind = settingsEditorKind(schema, value, choices)
  const overridden = hasSettingsPath(snapshot.user, path)
  const [draftRevision, setDraftRevision] = useState(snapshot.revision)
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const saveMutation = useMutation({
    mutationFn: (input: { readonly draft: string; readonly revision: number }): Promise<boolean> => {
      const parsed = parseSettingsDraft(input.draft, kind, choices)
      if (!parsed.ok) throw new Error(t(parsed.messageKey))
      return form.mutate(setOperationForSettingsTarget(props.result.target, parsed.value), input.revision)
    },
    onMutate: () => setMessage(null),
    onSuccess: accepted => {
      setMessage(accepted ? t('saved') : t('hostRefusedKeepDraft'))
      setConflict(!accepted)
      if (accepted) draftForm.reset()
    },
    onError: error => setMessage(errorMessage(error, t('saveFailed'))),
  })
  const resetMutation = useMutation({
    mutationFn: (revision: number | undefined): Promise<boolean> => form.mutate(unsetOperationForSettingsTarget(props.result.target), revision),
    onMutate: () => setMessage(null),
    onSuccess: accepted => {
      setMessage(accepted ? t('restored') : t('hostRefused'))
      setConflict(!accepted)
      if (accepted) draftForm.reset()
    },
    onError: error => setMessage(errorMessage(error, t('resetFailed'))),
  })
  const pending = saveMutation.isPending || resetMutation.isPending
  const draftForm = useAppForm({
    defaultValues: { draft: formatSettingsDraft(value, kind, choices) },
    onSubmit: ({ value: submitted }) => {
      if (draftRevision === undefined) return
      saveMutation.mutate({ draft: submitted.draft, revision: draftRevision })
    },
  })
  const draft = useStore(draftForm.store, state => state.values.draft)
  const dirty = useStore(draftForm.store, state => state.isDirty)
  const canWrite = snapshot.status === 'ready' && snapshot.writable && snapshot.revision !== undefined && !pending
  const parsed = parseSettingsDraft(draft, kind, choices)
  const valueId = useId()
  const titleId = useId()

  useEffect(() => {
    if (dirty) return
    draftForm.reset({ draft: formatSettingsDraft(value, kind, choices) })
    setDraftRevision(snapshot.revision)
  }, [choices, dirty, draftForm, kind, snapshot.revision, value])

  const save = (): void => {
    if (!canWrite) return
    if (!parsed.ok) {
      setMessage(t(parsed.messageKey))
      return
    }
    void draftForm.handleSubmit()
  }

  const reset = (): void => {
    if (!canWrite || !overridden) return
    resetMutation.mutate(snapshot.revision)
  }

  const updateDraft = (next: string): void => {
    if (!dirty) setDraftRevision(snapshot.revision)
    draftForm.setFieldValue('draft', next)
    setMessage(null)
  }

  const reloadLatest = (): void => {
    draftForm.reset({ draft: formatSettingsDraft(value, kind, choices) })
    setDraftRevision(snapshot.revision)
    setConflict(false)
    setMessage(null)
  }

  return (
    <section aria-labelledby={titleId} className="dshx:flex dshx:flex-col dshx:gap-4">
      <Button className="dshx:-ml-2 dshx:self-start" onClick={props.onBack} size="sm" type="button" variant="ghost">
        <ChevronLeftIcon />
        {t('backToResults')}
      </Button>
      <div className="dshx:flex dshx:flex-col dshx:gap-1">
        <p className="dshx:text-xs dshx:text-muted-foreground">{props.result.context}</p>
        <h2 className="dshx:text-sm dshx:font-semibold" id={titleId}>
          {props.result.title}
        </h2>
        {props.result.description.length > 0 && <p className="dshx:text-sm dshx:text-muted-foreground">{props.result.description}</p>}
        <code className="dshx:font-mono dshx:text-xs dshx:break-all dshx:text-muted-foreground">
          {props.result.target.entryId} · {path.join(' · ')}
        </code>
      </div>
      {snapshot.status === 'loading' && (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="status">
          <Spinner aria-hidden="true" role="presentation" />
          {t('loadingSetting')}
        </p>
      )}
      {snapshot.status === 'unavailable' && (
        <Alert role="status" variant="info">
          <InfoIcon />
          <AlertDescription>{t('settingUnavailable')}</AlertDescription>
        </Alert>
      )}
      {snapshot.status === 'ready' && (
        <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-4">
          <Field className="dshx:flex-col dshx:gap-2">
            <FieldLabel htmlFor={valueId}>{t('currentValue')}</FieldLabel>
            {kind === 'boolean' && (
              <Switch autoFocus checked={draft === 'true'} disabled={!canWrite} id={valueId} onCheckedChange={checked => updateDraft(String(checked))} />
            )}
            {kind === 'choice' && (
              <Select disabled={!canWrite} name="settings-search-value" onValueChange={updateDraft} value={draft}>
                <SelectTrigger autoFocus className="dshx:w-full dshx:max-w-sm" id={valueId}>
                  <SelectValue placeholder={t('chooseOption')} />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice, index) => (
                    <SelectItem key={String(index)} value={String(index)}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {kind === 'number' && (
              <Input
                autoComplete="off"
                autoFocus
                className="dshx:max-w-48 dshx:font-mono! dshx:tabular-nums"
                disabled={!canWrite}
                id={valueId}
                inputMode="decimal"
                onChange={event => updateDraft(event.currentTarget.value)}
                type="number"
                value={draft}
              />
            )}
            {(kind === 'string' || kind === 'json') && (
              <Textarea
                autoComplete="off"
                autoFocus
                className={kind === 'string' ? 'dshx:min-h-20' : 'dshx:min-h-28 dshx:font-mono! dshx:text-xs'}
                disabled={!canWrite}
                id={valueId}
                onChange={event => updateDraft(event.currentTarget.value)}
                rows={kind === 'string' ? 4 : 6}
                value={draft}
              />
            )}
            <FieldDescription className="dshx:text-xs">
              {snapshot.writable ? t('hostDocumentRevision', { revision: snapshot.revision ?? t('revisionPending') }) : t('readOnly')}
              {` · ${overridden ? t('customValue') : t('inheritedValue')}`}
            </FieldDescription>
          </Field>
          {message !== null && (
            <p className="dshx:text-xs dshx:text-muted-foreground" role="status">
              {message}
            </p>
          )}
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <Button disabled={!canWrite || !dirty || !parsed.ok} onClick={save} size="sm" type="button">
              {pending ? t('saving') : t('saveSetting')}
            </Button>
            <Button disabled={!canWrite || !overridden} onClick={reset} size="sm" type="button" variant="outline">
              {t('restoreInherited')}
            </Button>
            {conflict && (
              <Button disabled={pending} onClick={reloadLatest} size="sm" type="button" variant="ghost">
                <RefreshCwIcon />
                {t('reloadLatest')}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export const SettingsFieldEditor = (props: SettingsFieldEditorProps): JSX.Element => (
  <PluginQueryProvider>
    <SettingsFieldEditorContent {...props} />
  </PluginQueryProvider>
)
