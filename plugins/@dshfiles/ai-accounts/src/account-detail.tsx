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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { ArrowDownIcon, ArrowUpIcon, ArrowUpRightIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { useId } from 'react'
import { SessionSection } from './session-section.js'
import { AccountIdentitySection } from './account-identity-section.js'
import { KIND_LABEL, routedKind } from './account-labels.js'
import { accountRemoveMachine } from './account-remove-machine.js'
import { AutoSaveIndicator } from './auto-save-indicator.js'
import type { AccountDraft, AccountsFile } from './api.js'
import { ModelCuration } from './model-curation.js'
import { NumberedSection, ProviderGlyph } from './panel-primitives.js'
import { QuotaSection } from './quota-section.js'
import { RuntimePathsSection } from './runtime-paths-section.js'
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
  const { catalog, refreshingCatalog, refreshCatalog, selected, setDraft, persist, save, remove, dirty, saving, problem } = props.state
  const [removeSnapshot, sendRemove] = useMachine(accountRemoveMachine, { input: { removeAccount: remove } })
  const removalInProgress = removeSnapshot.matches('removing')
  const removeDialogOpen = removeSnapshot.matches('confirming') || removalInProgress || removeSnapshot.matches('error')
  const enabledSwitchId = useId()
  const sameProvider = props.file.accounts.filter(account => account.kind === draft.kind)
  const priorityIndex = sameProvider.findIndex(account => account.instanceId === selected?.instanceId)
  const reorderingDisabled = dirty || saving || props.state.reordering || priorityIndex < 0
  return (
    <section
      aria-label="Selected account"
      className="dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:rounded-xl dshx:border dshx:bg-card dshx:shadow-sm"
    >
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-4 dshx:p-6 dshx:@max-pane-narrow:p-4">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3">
          <ProviderGlyph kind={draft.kind} large />
          <div className="dshx:min-w-0">
            <p className="dshx:text-xs dshx:text-muted-foreground">
              {KIND_LABEL[draft.kind]}
              {selected?.plan ? ` · ${selected.plan}` : ''}
            </p>
            <h2 className="dshx:truncate dshx:text-xl dshx:font-semibold dshx:tracking-tight">{draft.displayName || draft.instanceId}</h2>
            <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              {selected?.identity ?? (selected?.signedIn ? 'Credentials available' : 'Not connected')}
            </p>
          </div>
        </div>
      </header>

      <Tabs className="dshx:min-w-0 dshx:gap-0" defaultValue={routedKind(draft.kind) ? 'models' : 'usage'}>
        <div className="dshx:border-b dshx:px-6 dshx:@max-pane-narrow:px-4">
          <TabsList aria-label="Account sections" className="dshx:h-11 dshx:gap-5 dshx:p-0" variant="line">
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent className="dshx:min-w-0 dshx:p-6 dshx:@max-pane-narrow:p-4" value="models">
          {routedKind(draft.kind) ? (
            <NumberedSection
              actions={
                <Button
                  disabled={refreshingCatalog || selected?.instanceId !== draft.instanceId}
                  onClick={() => {
                    if (draft.instanceId !== '') void refreshCatalog(draft.instanceId)
                  }}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <RefreshCwIcon />
                  {refreshingCatalog ? 'Checking…' : 'Check now'}
                </Button>
              }
              title="Models"
            >
              <p className="dshx:mb-3 dshx:text-sm dshx:text-muted-foreground">
                Choose the models shown in the picker. Star favorites and set a default reasoning effort for each model.
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
          ) : (
            <p className="dshx:py-6 dshx:text-sm dshx:text-muted-foreground">Cursor tracks quota here. Models and sessions use the Cursor Agent runtime.</p>
          )}
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:p-6 dshx:@max-pane-narrow:p-4" value="settings">
          <AccountIdentitySection draft={draft} state={props.state} />
          <NumberedSection title="Account availability">
            <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-lg dshx:border dshx:p-4">
              <div className="dshx:min-w-0">
                <Label className="dshx:text-sm" htmlFor={enabledSwitchId}>
                  {routedKind(draft.kind)
                    ? draft.enabled
                      ? 'Enabled in model picker'
                      : 'Hidden from model picker'
                    : draft.enabled
                      ? 'Tracking quota'
                      : 'Quota tracking off'}
                </Label>
                <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">
                  {routedKind(draft.kind) ? 'Disabled accounts are not offered as model routes.' : 'Enable this account to include its quota readings.'}
                </p>
              </div>
              <Switch checked={draft.enabled} id={enabledSwitchId} onCheckedChange={enabled => void persist({ enabled })} />
            </div>
          </NumberedSection>
          {routedKind(draft.kind) ? (
            <NumberedSection title="Account priority">
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm">
                  {priorityIndex < 0
                    ? 'Save this account to set its priority.'
                    : `Priority ${priorityIndex + 1} of ${sameProvider.length} for ${KIND_LABEL[draft.kind]}`}
                </p>
                <Button
                  aria-label={`Move ${draft.displayName} earlier in account order`}
                  disabled={reorderingDisabled || priorityIndex === 0}
                  onClick={() => {
                    if (selected !== null) props.state.moveAccount(selected.instanceId, 'earlier')
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ArrowUpIcon />
                  Earlier
                </Button>
                <Button
                  aria-label={`Move ${draft.displayName} later in account order`}
                  disabled={reorderingDisabled || priorityIndex === sameProvider.length - 1}
                  onClick={() => {
                    if (selected !== null) props.state.moveAccount(selected.instanceId, 'later')
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ArrowDownIcon />
                  Later
                </Button>
              </div>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                This is the shared account order. Priority routing tries compatible accounts in this order; other routing policies keep their own behavior.
              </p>
            </NumberedSection>
          ) : null}
          <SessionSection draft={draft} file={props.file} state={props.state} />
          <details className="dshx:mt-4 dshx:rounded-lg dshx:border dshx:px-4 dshx:py-3">
            <summary className="dshx:cursor-pointer dshx:text-sm dshx:font-medium">Advanced</summary>
            <p className="dshx:mt-2 dshx:text-xs dshx:text-muted-foreground">Route identifiers, picker appearance and host runtime paths.</p>
            <AccountIdentitySection advanced draft={draft} state={props.state} />
            <RuntimePathsSection draft={draft} folderPicker={props.folderPicker} state={props.state} />
          </details>
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:p-6 dshx:@max-pane-narrow:p-4" value="usage">
          <p className="dshx:mb-3 dshx:text-sm dshx:text-muted-foreground">
            Provider-reported subscription quota and stored readings for this account. Quota is not a measure of request count or spend.
          </p>
          <QuotaSection state={props.state} />
          <Button className="dshx:mt-4" onClick={props.onOpenUsageHistory} size="sm" type="button" variant="outline">
            <ArrowUpRightIcon />
            Usage history
          </Button>
        </TabsContent>
      </Tabs>

      <footer className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:px-6 dshx:py-3 dshx:@max-pane-narrow:px-4">
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
        {props.state.saveMode === 'manual' && dirty ? (
          <span className="dshx:text-xs dshx:text-muted-foreground" role="status">
            {problem ?? 'Unsaved changes.'}
          </span>
        ) : null}
        <Button
          className="dshx:ml-auto dshx:text-destructive dshx:hover:text-destructive"
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) sendRemove({ type: 'request', target: { instanceId: selected.instanceId, displayName: selected.displayName } })
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
