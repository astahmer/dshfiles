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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { BarChart3Icon, LayersIcon, MoreHorizontalIcon, PencilIcon, RefreshCwIcon, Settings2Icon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountSignOut } from './account-sign-out.js'
import { AccountSettings, AccountInlineSettings } from './account-settings.js'
import { AccountNameEditor } from './account-name-editor.js'
import { accountConnectionStatus, type AccountSection } from './account-connection-status.js'
import { routedKind } from './account-labels.js'
import { accountRemoveMachine } from './account-remove-machine.js'
import { AutoSaveIndicator } from './auto-save-indicator.js'
import type { AccountDraft, AccountsFile } from './api.js'
import { ModelCuration } from './model-curation.js'
import { ProviderGlyph } from './panel-primitives.js'
import { QuotaSection } from './quota-section.js'
import { AccountUsageSlot } from './account-usage-view.js'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import type { AccountsPanelState } from './use-accounts-panel-state.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

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
  const status = selected === null ? null : accountConnectionStatus(selected, props.state.usage)
  const connect = (): void => {
    if (selected !== null && !dirty && !saving) props.onConnectAccount(selected.instanceId)
  }
  const requestRemove = (): void => {
    if (selected !== null) sendRemove({ type: 'request', target: { instanceId: selected.instanceId, displayName: selected.displayName } })
  }
  return (
    <section
      aria-label="Selected account"
      className="dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:rounded-xl dshx:border dshx:border-border/60 dshx:bg-card"
    >
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-4 dshx:px-6 dshx:py-5 dshx:@max-pane-narrow:px-4">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-4">
          <ProviderGlyph kind={draft.kind} large />
          <div className="dshx:min-w-0 dshx:flex-1">
            <AccountNameEditor
              disabled={saving}
              editing={props.editingName}
              name={draft.displayName || draft.instanceId}
              onChange={displayName => setDraft({ ...draft, displayName })}
              onEditingChange={props.onEditingNameChange}
            />
            <p className="dshx:mt-1.5 dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              {[selected?.plan, selected?.identity].filter(Boolean).join(' · ') || 'Identity not reported by provider'}
            </p>
          </div>
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-3">
          <div
            className={cn(
              'dshx:rounded-lg dshx:px-3 dshx:py-2 dshx:text-xs',
              status?.tone === 'success' ? 'dshx:bg-success/10 dshx:text-success' : 'dshx:bg-muted/50 dshx:text-muted-foreground',
            )}
          >
            <span className="dshx:flex dshx:items-center dshx:gap-2">
              <StatusDot tone="current" />
              {status?.label ?? 'Not connected'}
            </span>
            <small className="dshx:mt-1 dshx:block dshx:text-[10px]">
              {status?.checkedAt == null
                ? 'Not checked by provider'
                : `Last checked ${new Date(status.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </small>
          </div>
          <Switch
            aria-label={
              routedKind(draft.kind)
                ? draft.enabled
                  ? 'Enabled in model picker'
                  : 'Hidden from model picker'
                : draft.enabled
                  ? 'Tracking quota'
                  : 'Quota tracking off'
            }
            checked={draft.enabled}
            className="dshx:data-[state=checked]:bg-info"
            disabled={saving}
            onCheckedChange={enabled => void props.state.persist({ enabled })}
          />
          {selected === null ? null : <AccountSignOut account={selected} disabled={dirty || saving} onSignedOut={() => void props.state.load()} />}
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
              <DropdownMenuItem disabled={selected === null} onSelect={requestRemove} variant="destructive">
                <Trash2Icon />
                Remove profile
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <Tabs
        className="dshx:min-w-0 dshx:gap-0"
        onValueChange={section => {
          if (section === 'models' || section === 'settings' || section === 'usage') props.onSectionChange(section)
        }}
        value={props.activeSection}
      >
        <div className="dshx:border-b dshx:px-4">
          <TabsList
            aria-label="Account sections"
            className="dshx:h-12 dshx:gap-6 dshx:p-0 dshx:@max-pane-narrow:w-full dshx:@max-pane-narrow:gap-0"
            variant="line"
          >
            {(
              [
                { id: 'models', label: 'Models', Icon: LayersIcon },
                { id: 'settings', label: 'Settings', Icon: Settings2Icon },
                { id: 'usage', label: 'Usage', Icon: BarChart3Icon },
              ] as const
            ).map(tab => (
              <TabsTrigger
                className="dshx:gap-2 dshx:px-3 dshx:font-medium dshx:data-[state=active]:text-info dshx:data-[state=active]:after:bg-info dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:px-2 dshx:@max-pane-narrow:text-xs"
                key={tab.id}
                value={tab.id}
              >
                <tab.Icon className="dshx:size-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent className="dshx:min-w-0 dshx:space-y-4 dshx:p-4" value="models">
          {routedKind(draft.kind) ? (
            <>
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
              <AccountInlineSettings draft={draft} file={props.file} state={props.state} onConnect={connect} />
            </>
          ) : (
            <p className="dshx:py-6 dshx:text-sm dshx:text-muted-foreground">Cursor tracks quota here. Models and sessions use the Cursor Agent runtime.</p>
          )}
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:p-4" value="settings">
          <AccountSettings draft={draft} file={props.file} state={props.state} folderPicker={props.folderPicker} onConnect={connect} />
        </TabsContent>
        <TabsContent className="dshx:min-w-0 dshx:space-y-4 dshx:p-4" value="usage">
          <AccountUsageSlot accountId={draft.instanceId} displayName={draft.displayName} onOpenUsageHistory={props.onOpenUsageHistory} />
          <details className="dshx:rounded-lg dshx:border dshx:bg-card dshx:p-4">
            <summary className="dshx:cursor-pointer dshx:text-sm dshx:font-semibold">Subscription quota & history</summary>
            <p className="dshx:my-3 dshx:text-xs dshx:text-muted-foreground">
              Provider-reported subscription allowance is separate from recorded requests and list-price estimates.
            </p>
            <QuotaSection state={props.state} />
            <Button className="dshx:mt-3" onClick={props.onOpenUsageHistory} size="sm" type="button" variant="outline">
              Usage history
            </Button>
          </details>
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
            {removeSnapshot.matches('error') ? <p role="alert">Could not remove this profile. Try again or cancel.</p> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={() => sendRemove({ type: removeSnapshot.matches('error') ? 'retry' : 'confirm' })}
              variant="destructive"
            >
              {removing ? 'Removing…' : removeSnapshot.matches('error') ? 'Try again' : 'Remove profile'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
