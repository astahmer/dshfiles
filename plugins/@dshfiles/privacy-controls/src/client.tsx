import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClientPlugin, useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage, PluginQueryProvider, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { privacyControlsApi, type PrivacyFeatureState } from './api/privacy-controls.js'
import type { PrivacyFeatureId } from './features.js'
import './client.css'

const privacyControlsQueryKey = ['privacy-controls', 'snapshot'] as const

const featureRows = [
  {
    feature: 'answer-feedback-ui',
    title: 'Answer feedback UI',
    description: 'Show the per-answer thumbs and feedback dialog. The DSH client bundle also requires Session feedback capture.',
  },
  {
    feature: 'session-feedback-capture',
    title: 'Session feedback capture',
    description: 'Enable /feedback text capture. Entries are saved in the session log and are not shown to the model.',
  },
  {
    feature: 'otel-session-upload',
    title: 'OpenTelemetry session upload',
    description:
      'After explicit feedback, send the session-log prefix through that feedback (including context) to the configured OTel collector. Redaction depends on profile rules.',
  },
  {
    feature: 'deepseek-session-log-upload',
    title: 'Official DeepSeek session-log upload',
    description:
      'Send the unaccepted session-log suffix as a dsh_session_log field in official DeepSeek API requests. It is not model input; re-enabling can upload queued events.',
  },
  {
    feature: 'session-log-download',
    title: 'Download session logs',
    description: 'Keep local session-log downloads available. The master action never changes this switch.',
  },
] as const satisfies readonly { readonly feature: PrivacyFeatureId; readonly title: string; readonly description: string }[]

const privacyFeatureStatus = (state: PrivacyFeatureState, dependencyHint: string | null): string | null => {
  if (state.mixed) return 'The underlying DSH rows differ; changing this switch will set them together.'
  if (state.needsRestart) return 'Saved. Restart DSH to apply this change.'
  if (state.overridden) return state.reason ?? 'Another profile entry is overriding this switch.'
  return dependencyHint
}

type PrivacyMutation =
  | { readonly kind: 'feature'; readonly feature: PrivacyFeatureId; readonly enabled: boolean }
  | { readonly kind: 'all'; readonly enabled: boolean }

const PrivacyControlsPage = (): JSX.Element => {
  const api = useApi(privacyControlsApi)
  const queryClient = useQueryClient()
  const [confirmEnableAll, setConfirmEnableAll] = useState(false)
  const query = useQuery({
    queryKey: privacyControlsQueryKey,
    queryFn: ({ signal }) => api.read(undefined, { signal }),
  })
  const update = useMutation({
    mutationFn: (input: PrivacyMutation) =>
      input.kind === 'all' ? api.setAll({ enabled: input.enabled }) : api.setFeature({ feature: input.feature, enabled: input.enabled }),
    onSuccess: snapshot => queryClient.setQueryData(privacyControlsQueryKey, snapshot),
  })

  const snapshot = query.data
  const stateOf = (feature: PrivacyFeatureId) => snapshot?.features.find(state => state.feature === feature)
  const masterStates = featureRows.filter(row => row.feature !== 'session-log-download').map(row => stateOf(row.feature))
  const anyMasterEnabled = masterStates.some(state => state?.enabled === true)
  const anyMasterAvailable = masterStates.some(state => state?.available === true)
  const allMasterAvailable = masterStates.every(state => state?.available === true)
  const masterDisabled = update.isPending || snapshot?.available !== true || (anyMasterEnabled ? !anyMasterAvailable : !allMasterAvailable)
  const answerFeedback = stateOf('answer-feedback-ui')
  const sessionFeedback = stateOf('session-feedback-capture')
  const updateError = update.isError ? errorMessage(update.error, 'Could not save this privacy setting.') : null
  const queryError = query.isError ? errorMessage(query.error, 'Could not read this profile’s privacy settings.') : null

  const setMaster = (): void => {
    if (anyMasterEnabled) {
      update.mutate({ kind: 'all', enabled: false })
      return
    }
    setConfirmEnableAll(true)
  }

  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:p-4">
      <header className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
        <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">Feedback &amp; privacy</h2>
        <p className="dshx:m-0 dshx:max-w-3xl dshx:text-sm dshx:text-muted-foreground">
          Choose which feedback surfaces and session-data paths are enabled for this Web profile.
        </p>
      </header>

      {snapshot?.available === false ? (
        <p className="dshx:m-0 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted dshx:p-3 dshx:text-sm" role="status">
          {snapshot.reason ?? 'Privacy controls are unavailable in this profile.'}
        </p>
      ) : null}
      {queryError === null ? null : (
        <p className="dshx:m-0 dshx:text-sm dshx:text-destructive" role="alert">
          {queryError}
        </p>
      )}

      <section className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-4">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
          <div className="dshx:min-w-0 dshx:flex-1">
            <h3 className="dshx:m-0 dshx:text-sm dshx:font-semibold">Feedback and uploads</h3>
            <p className="dshx:m-0 dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">
              Enable or disable the four feedback/upload features together. Session-log download stays independent.
            </p>
          </div>
          <Button disabled={masterDisabled} onClick={setMaster} size="sm" variant={anyMasterEnabled ? 'outline' : 'default'}>
            {anyMasterEnabled ? 'Disable all feedback & uploads' : 'Enable all feedback & uploads'}
          </Button>
        </div>
      </section>

      <ul className="dshx:m-0 dshx:flex dshx:min-w-0 dshx:list-none dshx:flex-col dshx:gap-2 dshx:p-0">
        {featureRows.map(row => {
          const state = stateOf(row.feature)
          if (state === undefined) {
            return (
              <li className="dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-4" key={row.feature}>
                <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">{row.title}</p>
                <p className="dshx:m-0 dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">Reading profile settings…</p>
              </li>
            )
          }
          const requiresSessionCapture =
            row.feature === 'answer-feedback-ui' && !state.enabled && (sessionFeedback?.available !== true || sessionFeedback.enabled !== true)
          const sessionCaptureInUse = row.feature === 'session-feedback-capture' && state.enabled && answerFeedback?.enabled === true
          const feedbackDependencyWarning =
            row.feature === 'answer-feedback-ui' && state.enabled && sessionFeedback?.enabled !== true
              ? 'Answer feedback UI lacks its required Host service; turn it off or enable Session feedback capture.'
              : row.feature === 'session-feedback-capture' && !state.enabled && answerFeedback?.enabled === true
                ? 'Session feedback is required by Answer feedback UI; enable it to restore compatibility or disable that UI.'
                : null
          const dependencyHint = requiresSessionCapture
            ? 'Enable Session feedback capture first; DSH’s answer-feedback UI requires that Host service.'
            : sessionCaptureInUse
              ? 'Turn off Answer feedback UI first; it requires the session-feedback Host service.'
              : feedbackDependencyWarning
          const dependencyBlocked = requiresSessionCapture || sessionCaptureInUse
          const unavailable = !state.available
          const status = privacyFeatureStatus(state, dependencyHint)
          return (
            <li
              className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-4 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:px-4 dshx:py-3 dshx:@max-pane-narrow:flex-col dshx:@max-pane-narrow:items-stretch dshx:@max-pane-narrow:gap-3"
              key={row.feature}
            >
              <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
                <label className="dshx:w-fit dshx:cursor-pointer dshx:text-sm dshx:font-medium" htmlFor={`privacy-${row.feature}`}>
                  {row.title}
                </label>
                <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{row.description}</p>
                {unavailable || status !== null ? (
                  <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground" role={unavailable ? 'status' : undefined}>
                    {unavailable ? (state.reason ?? 'This feature is not present in the active profile.') : status}
                  </p>
                ) : null}
              </div>
              <Switch
                id={`privacy-${row.feature}`}
                aria-label={row.title}
                checked={state.enabled}
                disabled={update.isPending || unavailable || dependencyBlocked}
                onCheckedChange={(enabled: boolean) => update.mutate({ kind: 'feature', feature: row.feature, enabled })}
              />
            </li>
          )
        })}
      </ul>

      <p className="dshx:m-0 dshx:rounded-lg dshx:bg-muted dshx:p-3 dshx:text-xs dshx:text-muted-foreground">
        OpenTelemetry exports the authorized session-log prefix after explicit feedback; redaction depends on profile rules. Official DeepSeek upload sends the
        unaccepted log suffix as a separate request field, not model input; re-enabling may upload queued events. Downloads stay local.
      </p>
      {updateError === null ? null : (
        <p className="dshx:m-0 dshx:text-sm dshx:text-destructive" role="alert">
          {updateError}
        </p>
      )}

      <AlertDialog open={confirmEnableAll} onOpenChange={setConfirmEnableAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable all feedback and uploads?</AlertDialogTitle>
            <AlertDialogDescription>
              This enables session feedback, OpenTelemetry export after explicit feedback, and the official DeepSeek API session-log field. OTel may receive the
              session prefix including context; the API field is separate from model input. Re-enabling the API uploader can send any still-unaccepted log
              suffix.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={update.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={update.isPending || !allMasterAvailable}
              onClick={() => {
                setConfirmEnableAll(false)
                update.mutate({ kind: 'all', enabled: true })
              }}
            >
              Enable all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

const PrivacyControlsSettingsSection = (): JSX.Element => (
  <PluginQueryProvider>
    <PrivacyControlsPage />
  </PluginQueryProvider>
)

export default defineClientPlugin({
  id: 'dshfiles-privacy-controls',
  name: '@dshfiles/privacy-controls',
  uses: ['ui'],
  setup(api) {
    api.ui.register({ name: 'settings.section', id: 'dshfiles-privacy-controls', order: 75, label: () => 'Feedback & privacy' }, PrivacyControlsSettingsSection)
  },
})
