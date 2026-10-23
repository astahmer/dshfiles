import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useAppForm, revalidateLogic } from '@dshfiles/plugin-ui/form'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import {
  ActivityIcon,
  ArchiveIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  InboxIcon,
  ListIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from '@dshfiles/plugin-ui/icons'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, type ThreadSidebarLocaleKey } from './locales.js'
import {
  ALL_THREADS_VIEW_ID,
  DONE_VIEW_ID,
  GONE_VIEW_ID,
  INBOX_VIEW_ID,
  LEGACY_CURRENT_VIEW_ID,
  MAX_THREAD_VIEWS,
  ThreadViewPreferencesModel,
  type ThreadViewPreset,
  type ThreadViewSettings,
  WORKING_VIEW_ID,
} from './thread-view-preferences.js'
import { THREAD_GROUP_BY_OPTIONS, THREAD_SOURCE_FILTER_OPTIONS, THREAD_STATUS_FILTER_GROUPS, THREAD_STATUS_FILTER_OPTIONS } from './thread-view.js'

export type ThreadSidebarTranslate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>

const groupLabelKeys = {
  project: 'threadSidebarGroupProject',
  date: 'threadSidebarGroupDate',
  status: 'threadSidebarGroupStatus',
  none: 'threadSidebarGroupNone',
} as const

/** One label map for the filter menu, the view editor and the header summary. */
export const threadStatusFilterLabelKeys = {
  all: 'threadSidebarAllThreads',
  working: 'threadSidebarWorking',
  attention: 'threadSidebarFilterAttention',
  unread: 'threadSidebarUnread',
  'approval-needed': 'threadSidebarApprovalNeeded',
  'input-needed': 'threadSidebarInputNeeded',
  'turn-finished': 'threadSidebarTurnFinished',
  'needs-resume': 'threadSidebarNeedsResume',
  interrupted: 'threadSidebarInterrupted',
  inactive: 'threadSidebarInactive',
  muted: 'threadSidebarFilterMuted',
  settled: 'threadSidebarSettled',
  archived: 'threadSidebarArchived',
} as const satisfies Record<(typeof THREAD_STATUS_FILTER_OPTIONS)[number], ThreadSidebarLocaleKey>

export const threadStatusFilterGroupLabelKeys = {
  activity: 'threadSidebarFilterGroupActivity',
  attention: 'threadSidebarFilterGroupAttention',
  storage: 'threadSidebarFilterGroupStorage',
} as const satisfies Record<(typeof THREAD_STATUS_FILTER_GROUPS)[number]['id'], ThreadSidebarLocaleKey>

const sourceLabelKeys = {
  all: 'threadSidebarFilterAllSources',
  main: 'threadSidebarFilterMainThreads',
  subagents: 'threadSidebarFilterSubagents',
} as const

export const threadViewPresetLabel = (view: ThreadViewPreset, t: ThreadSidebarTranslate): string => {
  if (view.name !== null) return view.name
  if (view.id === ALL_THREADS_VIEW_ID) return t('threadSidebarAllThreads')
  if (view.id === WORKING_VIEW_ID) return t('threadSidebarWorking')
  if (view.id === DONE_VIEW_ID) return t('threadSidebarDone')
  if (view.id === INBOX_VIEW_ID) return t('threadSidebarInbox')
  if (view.id === GONE_VIEW_ID) return t('threadSidebarGone')
  return t('threadSidebarCurrentView')
}

const builtInViewIcons: Readonly<Record<string, LucideIcon>> = {
  [ALL_THREADS_VIEW_ID]: ListIcon,
  [WORKING_VIEW_ID]: ActivityIcon,
  [DONE_VIEW_ID]: CircleCheckIcon,
  [INBOX_VIEW_ID]: InboxIcon,
  [GONE_VIEW_ID]: ArchiveIcon,
  [LEGACY_CURRENT_VIEW_ID]: BookmarkIcon,
}

export type ThreadViewCompactLabel = { readonly kind: 'icon'; readonly icon: LucideIcon } | { readonly kind: 'initial'; readonly initial: string }

/** What a view tab shows when the sidebar is too narrow for its name: a built-in view's icon, or a custom view's initial. */
export const threadViewPresetCompactLabel = (view: ThreadViewPreset): ThreadViewCompactLabel => {
  const icon = view.name === null ? builtInViewIcons[view.id] : undefined
  if (icon !== undefined) return { kind: 'icon', icon }
  const initial = Array.from(view.name?.trim() ?? '')[0] ?? '?'
  return { kind: 'initial', initial: initial.toLocaleUpperCase() }
}

interface ThreadViewManagerProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly settings: ThreadViewSettings
  readonly onSettingsChange: (settings: ThreadViewSettings) => boolean
  readonly t: ThreadSidebarTranslate
}

interface ThreadViewEditorProps {
  readonly view: ThreadViewPreset
  readonly settings: ThreadViewSettings
  readonly isNew: boolean
  readonly onSave: (view: ThreadViewPreset) => boolean
  readonly onCancel: () => void
  readonly t: ThreadSidebarTranslate
}

const ThreadViewEditor = (props: ThreadViewEditorProps): JSX.Element => {
  const translate = props.t
  const existingNames = useMemo(
    () => props.settings.views.filter(view => view.id !== props.view.id).map(view => threadViewPresetLabel(view, props.t).trim().toLowerCase()),
    [props.settings.views, props.t, props.view.id],
  )
  const editorSchema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, translate('threadSidebarViewNameRequired'))
            .max(32, translate('threadSidebarViewNameTooLong'))
            .refine(name => !existingNames.includes(name.toLowerCase()), translate('threadSidebarViewNameExists')),
          groupBy: z.enum(THREAD_GROUP_BY_OPTIONS),
          statusFilters: z.array(z.enum(THREAD_STATUS_FILTER_OPTIONS.filter(value => value !== 'all'))),
          sourceFilter: z.enum(THREAD_SOURCE_FILTER_OPTIONS),
        })
        .strict(),
    [existingNames, translate],
  )
  const [saveWarning, setSaveWarning] = useState(false)
  const form = useAppForm({
    defaultValues: {
      name: props.view.name ?? threadViewPresetLabel(props.view, props.t),
      groupBy: props.view.groupBy,
      statusFilters: props.view.statusFilters,
      sourceFilter: props.view.sourceFilter,
    },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: editorSchema },
    onSubmit: ({ value }) => {
      const saved = props.onSave({ ...props.view, ...value, name: value.name.trim() })
      if (saved) {
        setSaveWarning(false)
        props.onCancel()
      } else {
        setSaveWarning(true)
      }
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>{props.t(props.isNew ? 'threadSidebarAddView' : 'threadSidebarEditView')}</DialogTitle>
        <DialogDescription>{props.t('threadSidebarViewEditorHint')}</DialogDescription>
      </DialogHeader>
      {saveWarning ? (
        <Alert variant="warning">
          <AlertDescription>{props.t('threadSidebarStorageFailure')}</AlertDescription>
        </Alert>
      ) : null}
      <form
        className="dshx:grid dshx:gap-3"
        noValidate
        onSubmit={event => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.AppField name="name">{field => <field.TextField label={props.t('threadSidebarViewName')} required />}</form.AppField>
        <form.AppField name="groupBy">
          {field => (
            <field.SelectField
              label={props.t('threadSidebarViewGroup')}
              options={THREAD_GROUP_BY_OPTIONS.map(value => ({ value, label: props.t(groupLabelKeys[value]) }))}
            />
          )}
        </form.AppField>
        <form.AppField name="statusFilters">
          {field => (
            <fieldset className="dshx:grid dshx:gap-2">
              <legend className="dshx:text-sm dshx:font-medium">{props.t('threadSidebarViewStatus')}</legend>
              <Label className="dshx:font-normal">
                <Checkbox checked={field.state.value.length === 0} onCheckedChange={checked => checked === true && field.handleChange([])} />
                {props.t('threadSidebarAllThreads')}
              </Label>
              {THREAD_STATUS_FILTER_GROUPS.map(group => (
                <div className="dshx:grid dshx:gap-1.5" key={group.id}>
                  <p className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.t(threadStatusFilterGroupLabelKeys[group.id])}</p>
                  {group.filters.map(value => (
                    <Label className="dshx:font-normal" key={value}>
                      <Checkbox
                        checked={field.state.value.includes(value)}
                        onCheckedChange={checked =>
                          field.handleChange(checked === true ? [...field.state.value, value] : field.state.value.filter(selected => selected !== value))
                        }
                      />
                      {props.t(threadStatusFilterLabelKeys[value])}
                    </Label>
                  ))}
                </div>
              ))}
            </fieldset>
          )}
        </form.AppField>
        <form.AppField name="sourceFilter">
          {field => (
            <field.SelectField
              label={props.t('threadSidebarViewSource')}
              options={THREAD_SOURCE_FILTER_OPTIONS.map(value => ({ value, label: props.t(sourceLabelKeys[value]) }))}
            />
          )}
        </form.AppField>
        <DialogFooter>
          <Button onClick={props.onCancel} type="button" variant="outline">
            {props.t('threadSidebarCancel')}
          </Button>
          <Button type="submit">{props.t('threadSidebarSaveView')}</Button>
        </DialogFooter>
      </form>
    </>
  )
}

export const ThreadViewManager = (props: ThreadViewManagerProps): JSX.Element => {
  const [editingView, setEditingView] = useState<ThreadViewPreset | null>(null)
  const [saveWarning, setSaveWarning] = useState(false)
  const isNewView = editingView !== null && !props.settings.views.some(view => view.id === editingView.id)
  const enabledCount = props.settings.views.filter(view => view.enabled).length

  const saveSettings = (settings: ThreadViewSettings): boolean => {
    const saved = props.onSettingsChange(settings)
    setSaveWarning(!saved)
    return saved
  }

  const beginAdd = (): void => {
    if (props.settings.views.length >= MAX_THREAD_VIEWS) return
    setEditingView({
      id: `custom-${crypto.randomUUID()}`,
      name: '',
      enabled: true,
      groupBy: 'status',
      statusFilters: [],
      sourceFilter: 'all',
    })
  }

  const saveView = (view: ThreadViewPreset): boolean => saveSettings(ThreadViewPreferencesModel.saveThreadView(props.settings, view))

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) setEditingView(null)
        props.onOpenChange(open)
      }}
      open={props.open}
    >
      <DialogContent className="dshx-root dshx:max-h-[85vh] dshx:overflow-y-auto dshx:sm:max-w-xl" closeLabel={props.t('threadSidebarClose')}>
        {editingView !== null ? (
          <ThreadViewEditor
            key={editingView.id}
            isNew={isNewView}
            onCancel={() => setEditingView(null)}
            onSave={saveView}
            settings={props.settings}
            t={props.t}
            view={editingView}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{props.t('threadSidebarManageViews')}</DialogTitle>
              <DialogDescription>{props.t('threadSidebarManageViewsHint')}</DialogDescription>
            </DialogHeader>
            {saveWarning ? (
              <Alert variant="warning">
                <AlertDescription>{props.t('threadSidebarStorageFailure')}</AlertDescription>
              </Alert>
            ) : null}
            <div className="dshx:grid dshx:gap-2" role="list" aria-label={props.t('threadSidebarViews')}>
              {props.settings.views.map((view, index) => {
                const label = threadViewPresetLabel(view, props.t)
                const groupLabel = props.t(groupLabelKeys[view.groupBy])
                const statusLabel =
                  view.statusFilters.length === 0
                    ? props.t('threadSidebarAllThreads')
                    : view.statusFilters.map(status => props.t(threadStatusFilterLabelKeys[status])).join(', ')
                const sourceLabel = props.t(sourceLabelKeys[view.sourceFilter])
                return (
                  <div className="dshx:grid dshx:min-w-0 dshx:gap-1.5 dshx:rounded-md dshx:border dshx:p-2.5" key={view.id} role="listitem">
                    <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
                      <Label className="dshx:min-w-0 dshx:flex-1 dshx:font-normal">
                        <Checkbox
                          aria-label={`${props.t('threadSidebarEnableView')} ${label}`}
                          checked={view.enabled}
                          disabled={view.enabled && enabledCount === 1}
                          onCheckedChange={checked => saveSettings(ThreadViewPreferencesModel.setThreadViewEnabled(props.settings, view.id, checked === true))}
                        />
                        <span className="dshx:truncate">{label}</span>
                      </Label>
                      <Button
                        aria-label={`${props.t('threadSidebarMoveViewUp')} ${label}`}
                        disabled={index === 0}
                        onClick={() => saveSettings(ThreadViewPreferencesModel.moveThreadView(props.settings, view.id, -1))}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ChevronUpIcon />
                      </Button>
                      <Button
                        aria-label={`${props.t('threadSidebarMoveViewDown')} ${label}`}
                        disabled={index === props.settings.views.length - 1}
                        onClick={() => saveSettings(ThreadViewPreferencesModel.moveThreadView(props.settings, view.id, 1))}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ChevronDownIcon />
                      </Button>
                      <Button
                        aria-label={`${props.t('threadSidebarEditView')} ${label}`}
                        onClick={() => setEditingView(view)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        aria-label={`${props.t('threadSidebarRemoveView')} ${label}`}
                        disabled={props.settings.views.length === 1 || (view.enabled && enabledCount === 1)}
                        onClick={() => saveSettings(ThreadViewPreferencesModel.removeThreadView(props.settings, view.id))}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    <p className="dshx:pl-7 dshx:text-xs dshx:text-muted-foreground">
                      {props.t('threadSidebarGroup')}: {groupLabel} · {props.t('threadSidebarViewStatus')}: {statusLabel} · {props.t('threadSidebarViewSource')}
                      : {sourceLabel}
                    </p>
                  </div>
                )
              })}
            </div>
            <Button className="dshx:self-start" disabled={props.settings.views.length >= MAX_THREAD_VIEWS} onClick={beginAdd} type="button" variant="outline">
              <PlusIcon />
              {props.t('threadSidebarAddView')}
            </Button>
            {props.settings.views.some(view => view.id === LEGACY_CURRENT_VIEW_ID) ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('threadSidebarLegacyViewHint')}</p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
