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
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { ArrowUpRightIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { useId } from 'react'
import { AccountIdentitySection } from './account-identity-section.js'
import { KIND_SUBSCRIPTION, routedKind } from './account-labels.js'
import { accountRemoveMachine } from './account-remove-machine.js'
import { AutoSaveIndicator } from './auto-save-indicator.js'
import type { AccountDraft, AccountsFile } from './api.js'
import { ModelCuration } from './model-curation.js'
import { NumberedSection, ProviderMark } from './panel-primitives.js'
import { QuotaSection } from './quota-section.js'
import { RuntimePathsSection } from './runtime-paths-section.js'
import { SessionSection } from './session-section.js'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountDetail = (props: {
  readonly state: AccountsPanelState
  readonly draft: AccountDraft
  readonly file: AccountsFile
  readonly folderPicker: WorkspacePickerPorts
  readonly onOpenUsageHistory: () => void
}): JSX.Element => {
  const draft = props.draft
  const { catalog, refreshingCatalog, refreshCatalog, selected, setDraft, persist, save, remove, dirty, saving, notice, problem } = props.state
  const [removeSnapshot, sendRemove] = useMachine(accountRemoveMachine, { input: { removeAccount: remove } })
  const removalInProgress = removeSnapshot.matches('removing')
  const removeDialogOpen = removeSnapshot.matches('confirming') || removalInProgress || removeSnapshot.matches('error')
  const enabledSwitchId = useId()
  return (
    <section className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:px-5 dshx:py-3.5">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3.5 dshx:border-b dshx:pb-3">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3">
          <ProviderMark badge={draft.badge === '' ? 'AI' : draft.badge} color={draft.accentColor} size="lg" />
          <div className="dshx:min-w-0">
            <p className="dshx:text-[11px] dshx:font-semibold dshx:tracking-widest dshx:text-muted-foreground">{KIND_SUBSCRIPTION[draft.kind]}</p>
            <h2 className="dshx:truncate dshx:text-lg dshx:font-semibold dshx:tracking-tight">{draft.displayName || draft.instanceId}</h2>
          </div>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2.5">
          <Label className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" htmlFor={enabledSwitchId}>
            {routedKind(draft.kind)
              ? draft.enabled
                ? 'Enabled in model picker'
                : 'Hidden from model picker'
              : draft.enabled
                ? 'Tracking quota'
                : 'Quota tracking off'}
          </Label>
          <Switch checked={draft.enabled} id={enabledSwitchId} onCheckedChange={enabled => void persist({ enabled })} />
        </div>
      </header>

      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-auto dshx:overscroll-contain dshx:pr-1">
        <AccountIdentitySection draft={draft} state={props.state} />
        <RuntimePathsSection draft={draft} folderPicker={props.folderPicker} state={props.state} />
        {routedKind(draft.kind) ? (
          <NumberedSection
            actions={
              <Button
                disabled={refreshingCatalog || selected?.instanceId !== draft.instanceId}
                onClick={() => {
                  if (draft.instanceId === '') return
                  void refreshCatalog(draft.instanceId)
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon />
                {refreshingCatalog ? 'Checking…' : 'Check now'}
              </Button>
            }
            index="03"
            heading="Models"
          >
            <p className="dshx:text-xs dshx:text-muted-foreground">
              Show or hide models in the picker, star the ones you reach for, and pin a default reasoning effort per model.
            </p>
            {catalog?.instanceId === draft.instanceId && catalog.warning !== undefined ? (
              <p className="dshx:text-xs dshx:text-warning" role="status">
                {catalog.warning}
              </p>
            ) : null}
            <ModelCuration
              key={draft.instanceId}
              account={draft}
              catalog={catalog?.instanceId === draft.instanceId ? catalog.models : []}
              onChange={next => setDraft({ ...draft, ...next })}
            />
          </NumberedSection>
        ) : null}
        <QuotaSection state={props.state} />
        <SessionSection draft={draft} file={props.file} state={props.state} />
      </div>

      <footer className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:pt-3">
        {props.state.saveMode === 'manual' ? (
          <>
            <Button disabled={!dirty || saving || problem !== null} onClick={() => void save(draft)} size="sm" type="button">
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button disabled={!dirty} onClick={props.state.revert} size="sm" type="button" variant="outline">
              Revert
            </Button>
          </>
        ) : (
          <AutoSaveIndicator
            dirty={dirty}
            onRetry={props.state.retryAutoSave}
            problem={problem}
            renamePending={selected !== null && draft.instanceId !== selected.instanceId}
            status={props.state.autoSave}
          />
        )}
        <Button onClick={props.onOpenUsageHistory} size="sm" type="button" variant="ghost">
          <ArrowUpRightIcon />
          Usage history
        </Button>
        <span className="dshx:min-w-40 dshx:flex-1 dshx:text-xs dshx:text-muted-foreground" role="status">
          {notice ??
            (props.state.saveMode === 'manual' && dirty ? (problem ?? 'Unsaved changes.') : 'Provider and account are separate entries in the model picker.')}
        </span>
        <Button
          className="dshx:text-destructive dshx:hover:text-destructive"
          disabled={selected === null}
          onClick={() => {
            if (selected === null) return
            sendRemove({ type: 'request', target: { instanceId: selected.instanceId, displayName: selected.displayName } })
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
          Remove profile
        </Button>
      </footer>

      <AlertDialog
        onOpenChange={open => {
          if (!open && !removalInProgress) sendRemove({ type: 'cancel' })
        }}
        open={removeDialogOpen}
      >
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeSnapshot.context.target?.displayName ?? selected?.displayName ?? draft.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>The route leaves the model picker. Credentials stay on disk.</AlertDialogDescription>
            {removeSnapshot.matches('error') ? <p role="alert">Could not remove this profile. Try again or cancel.</p> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removalInProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removalInProgress}
              onClick={() => sendRemove({ type: removeSnapshot.matches('error') ? 'retry' : 'confirm' })}
              variant="destructive"
            >
              {removalInProgress ? 'Removing…' : removeSnapshot.matches('error') ? 'Try again' : 'Remove profile'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
