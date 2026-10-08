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
import { ArrowUpRightIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { useId, useState } from 'react'
import { AccountIdentitySection } from './account-identity-section.js'
import type { AccountDraft, AccountsFile } from './api.js'
import { ModelCuration } from './model-curation.js'
import { NumberedSection, ProviderMark } from './panel-primitives.js'
import { QuotaSection } from './quota-section.js'
import { RuntimePathsSection } from './runtime-paths-section.js'
import { SessionSection } from './session-section.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountDetail = (props: {
  readonly state: AccountsPanelState
  readonly draft: AccountDraft
  readonly file: AccountsFile
  readonly onOpenUsageHistory: () => void
}): JSX.Element => {
  const draft = props.draft
  const { catalog, refreshingCatalog, refreshCatalog, selected, setDraft, persist, save, remove, dirty, saving, notice } = props.state
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const enabledSwitchId = useId()
  const kicker = draft.kind === 'opencode-go' ? 'OPENCODE SUBSCRIPTION' : draft.kind === 'commandcode' ? 'COMMAND CODE' : 'CHATGPT SUBSCRIPTION'
  return (
    <section className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:px-5 dshx:py-3.5">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3.5 dshx:border-b dshx:pb-3">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3">
          <ProviderMark badge={draft.badge === '' ? 'AI' : draft.badge} color={draft.accentColor} size="lg" />
          <div className="dshx:min-w-0">
            <p className="dshx:text-[11px] dshx:font-semibold dshx:tracking-widest dshx:text-muted-foreground">{kicker}</p>
            <h2 className="dshx:truncate dshx:text-lg dshx:font-semibold dshx:tracking-tight">{draft.displayName || draft.instanceId}</h2>
          </div>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2.5">
          <Label className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" htmlFor={enabledSwitchId}>
            {draft.enabled ? 'Enabled in model picker' : 'Hidden from model picker'}
          </Label>
          <Switch checked={draft.enabled} id={enabledSwitchId} onCheckedChange={enabled => void persist({ enabled })} />
        </div>
      </header>

      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-auto dshx:overscroll-contain dshx:pr-1">
        <AccountIdentitySection draft={draft} state={props.state} />
        <RuntimePathsSection draft={draft} state={props.state} />
        <NumberedSection
          actions={
            <Button
              disabled={refreshingCatalog}
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
          title="Models"
        >
          <p className="dshx:text-xs dshx:text-muted-foreground">
            Show or hide models in the picker, star the ones you reach for, and pin a default reasoning effort per model.
          </p>
          <ModelCuration account={draft} catalog={catalog?.models ?? []} onChange={next => setDraft({ ...draft, ...next })} />
        </NumberedSection>
        <QuotaSection state={props.state} />
        <SessionSection draft={draft} file={props.file} state={props.state} />
      </div>

      <footer className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:pt-3">
        <Button disabled={!dirty || saving || draft.instanceId.trim().length === 0} onClick={() => void save(draft)} size="sm" type="button">
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button disabled={!dirty} onClick={() => setDraft(selected === null ? null : { ...selected })} size="sm" type="button" variant="outline">
          Revert
        </Button>
        <Button onClick={props.onOpenUsageHistory} size="sm" type="button" variant="ghost">
          <ArrowUpRightIcon />
          Usage history
        </Button>
        <span className="dshx:min-w-40 dshx:flex-1 dshx:text-xs dshx:text-muted-foreground" role="status">
          {notice ?? (dirty ? 'Unsaved changes.' : 'Provider and account are separate entries in the model picker.')}
        </span>
        <Button
          className="dshx:text-destructive dshx:hover:text-destructive"
          disabled={selected === null}
          onClick={() => setConfirmingRemove(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
          Remove profile
        </Button>
      </footer>

      <AlertDialog onOpenChange={setConfirmingRemove} open={confirmingRemove}>
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selected?.displayName ?? draft.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>The route leaves the model picker. Credentials stay on disk.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selected !== null) void remove(selected)
              }}
              variant="destructive"
            >
              Remove profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
