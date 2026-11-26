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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { ChevronRightIcon, LogOutIcon, MoreHorizontalIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import { AccountSignOut } from './account-sign-out.js'
import { AccountSettings } from './account-settings.js'
import { AccountNameEditor } from './account-name-editor.js'
import { AccountConnection, type AccountSection } from './account-connection-status.js'
import { AccountLabels } from './account-labels.js'
import { accountRemoveMachine } from './account-remove-machine.js'
import { AutoSaveIndicator } from './auto-save-indicator.js'
import type { AccountDraft, AccountsFile } from './api.js'
import { ModelCuration } from './model-curation.js'
import { ProviderGlyph } from './panel-primitives.js'
import { DETAIL_PANE_CLASS, DetailHeader } from './detail-header.js'
import { QuotaSection } from './quota-section.js'
import { AccountUsageSlot } from './account-usage-view.js'
import { UsageMovedNotice, useUsageRedirect } from './usage-redirect.js'
import type { WorkspacePickerPorts } from '@dshfiles/workspace-folder-picker/picker'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountDetail = (props: {
  readonly state: AccountsPanelState
  readonly draft: AccountDraft
  readonly file: AccountsFile
  readonly folderPicker: WorkspacePickerPorts
  readonly onOpenUsageHistory: () => void
  readonly onConnectAccount: (accountId: string) => void
  readonly activeSection: AccountSection
  readonly onSectionChange: (section: AccountSection) => void
  readonly editingName: boolean
  readonly onEditingNameChange: (editing: boolean) => void
}): JSX.Element => {
  const draft = props.draft
  const { catalog, refreshingCatalog, refreshCatalog, selected, setDraft, save, remove, dirty, saving, problem } = props.state
  const [removeSnapshot, sendRemove] = useMachine(accountRemoveMachine, { input: { removeAccount: remove } })
  const removing = removeSnapshot.matches('removing')
  const removeOpen = removeSnapshot.matches('confirming') || removing || removeSnapshot.matches('error')
  const status = selected === null ? null : AccountConnection.status(selected, props.state.usage)
  const stateLine = status === null ? null : AccountConnection.stateLine(status)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const connect = (): void => {
    if (selected !== null && !dirty && !saving) props.onConnectAccount(selected.instanceId)
  }
  const usageRedirect = useUsageRedirect({ accountId: draft.instanceId, displayName: draft.displayName || draft.instanceId })
  const requestRemove = (): void => {
    if (selected !== null) sendRemove({ type: 'request', target: { instanceId: selected.instanceId, displayName: selected.displayName } })
  }
  return (
    <section aria-label="Selected account" className={DETAIL_PANE_CLASS}>
      <DetailHeader
        detail={[selected?.plan == null ? null : AccountLabels.planLabel(selected.plan), selected?.identity, status && AccountConnection.checkedLabel(status)]
          .filter(Boolean)
          .join(' · ')}
        mark={<ProviderGlyph kind={draft.kind} />}
        state={stateLine}
        title={
          <AccountNameEditor
            disabled={saving}
            editing={props.editingName}
            name={draft.displayName || draft.instanceId}
            onChange={displayName => setDraft({ ...draft, displayName })}
            onEditingChange={props.onEditingNameChange}
          />
        }
      >
        <>
          {/* The switch says what it controls in visible text, not only to assistive tech (council round 4, D2). */}
          <Label className="dshx:gap-2 dshx:border-l dshx:border-border dshx:pl-3 dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
            {AccountLabels.routedKind(draft.kind) ? 'Show this account' : 'Track quota'}
            <Switch checked={draft.enabled} disabled={saving} onCheckedChange={enabled => void props.state.persist({ enabled })} />
          </Label>
          {selected === null ? null : (
            <AccountSignOut
              account={selected}
              disabled={dirty || saving}
              open={signOutOpen}
              onOpenChange={setSignOutOpen}
              onSignedOut={() => void props.state.load()}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Account actions" size="icon-sm" type="button" variant="outline">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={saving} onSelect={() => props.onEditingNameChange(true)}>
                <PencilIcon />
                Rename account
              </DropdownMenuItem>
              <DropdownMenuItem disabled={dirty || saving} onSelect={connect}>
                <RefreshCwIcon />
                Reauthenticate
              </DropdownMenuItem>
              <DropdownMenuItem disabled={refreshingCatalog || selected === null} onSelect={() => void refreshCatalog(draft.instanceId)}>
                <RefreshCwIcon />
                Refresh model catalog
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {selected?.signedIn === true ? (
                <DropdownMenuItem disabled={dirty || saving} onSelect={() => setSignOutOpen(true)}>
                  <LogOutIcon />
                  Sign out…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={selected === null} onSelect={requestRemove} variant="destructive">
                <Trash2Icon />
                Remove profile
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      </DetailHeader>
      <Tabs
        className="dshx:min-w-0 dshx:gap-0"
        onValueChange={section => {
          // Usage lives in Observe › Usage › Quota while usage runs: the tab opens it there.
          if (section === 'usage' && usageRedirect.open()) return
          if (section === 'models' || section === 'settings' || section === 'usage') props.onSectionChange(section)
        }}
        value={props.activeSection}
      >
        {/* Underline tabs, the page-section pattern Usage and Backlog use (council round 4, D2). */}
        <div className="dshx:mx-4 dshx:min-w-0 dshx:overflow-x-auto dshx:border-b dshx:border-border">
          <TabsList variant="line" aria-label="Account sections" className="dshx:h-10 dshx:gap-5 dshx:p-0">
            {(
              [
                { id: 'models', label: 'Models' },
                { id: 'settings', label: 'Settings' },
                { id: 'usage', label: 'Usage' },
              ] as const
            ).map(tab => (
              <TabsTrigger
                className="dshx:h-full dshx:flex-none dshx:rounded-none dshx:px-0 dshx:after:bottom-[-1px]! dshx:after:bg-foreground"
                key={tab.id}
                value={tab.id}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:divide-y dshx:px-4" value="models">
          {AccountLabels.routedKind(draft.kind) ? (
            <>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:py-4">
                <ModelCuration
                  account={draft}
                  catalog={catalog?.instanceId === draft.instanceId ? catalog.models : []}
                  onChange={patch => setDraft({ ...draft, ...patch })}
                />
                {catalog?.warning === undefined ? null : (
                  <p className="dshx:text-xs dshx:text-warning" role="status">
                    {catalog.warning}
                  </p>
                )}
                {/* Models is the models table; the account-wide defaults live on Settings (council round 3, D3). */}
                <Button className="dshx:self-start dshx:px-0" onClick={() => props.onSectionChange('settings')} size="sm" type="button" variant="link">
                  Model defaults
                  <ChevronRightIcon aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <p className="dshx:py-6 dshx:text-sm dshx:text-muted-foreground">Cursor tracks quota here. Its models and threads use the Cursor Agent runtime.</p>
          )}
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:px-4" value="settings">
          <AccountSettings draft={draft} file={props.file} state={props.state} folderPicker={props.folderPicker} onConnect={connect} />
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:space-y-4 dshx:p-4" value="usage">
          {usageRedirect.active ? (
            <UsageMovedNotice onOpen={usageRedirect.open} />
          ) : (
            <>
              <AccountUsageSlot accountId={draft.instanceId} displayName={draft.displayName} onOpenUsageHistory={props.onOpenUsageHistory} />
              <details className="dshx:border-t dshx:pt-4">
                <summary className="dshx:cursor-pointer dshx:text-sm dshx:font-semibold">Subscription quota & history</summary>
                <p className="dshx:my-3 dshx:text-xs dshx:text-muted-foreground">
                  Provider-reported subscription allowance is separate from recorded requests and list-price estimates.
                </p>
                <QuotaSection state={props.state} />
                <Button className="dshx:mt-3" onClick={props.onOpenUsageHistory} size="sm" type="button" variant="outline">
                  Usage history
                </Button>
              </details>
            </>
          )}
        </TabsContent>
      </Tabs>
      <footer className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:px-5 dshx:py-2.5">
        {props.state.saveMode === 'manual' ? (
          <>
            <Button disabled={!dirty || saving || problem !== null} onClick={() => void save(draft)} size="sm" type="button">
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button disabled={!dirty} onClick={props.state.revert} size="sm" type="button" variant="outline">
              Revert
            </Button>
            {dirty ? (
              <span className="dshx:text-xs dshx:text-muted-foreground" role="status">
                {problem ?? 'Unsaved changes.'}
              </span>
            ) : null}
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
      </footer>
      <AlertDialog
        onOpenChange={open => {
          if (!open && !removing) sendRemove({ type: 'cancel' })
        }}
        open={removeOpen}
      >
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeSnapshot.context.target?.displayName ?? selected?.displayName ?? draft.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>The route leaves the model picker. Credentials stay on disk.</AlertDialogDescription>
            {removeSnapshot.matches('error') ? <p role="alert">Could not remove this profile. Retry or cancel.</p> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={() => sendRemove({ type: removeSnapshot.matches('error') ? 'retry' : 'confirm' })}
              variant="destructive"
            >
              {removing ? 'Removing…' : removeSnapshot.matches('error') ? 'Retry' : 'Remove profile'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
