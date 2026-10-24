import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ArrowDownIcon, ArrowUpIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { KIND_LABEL, STATE_LABEL, routedKind } from './account-labels.js'
import type { AccountOrderDirection, AccountProfile } from './api.js'
import { ActionHint, ProviderGlyph } from './panel-primitives.js'

/** Priority indexes always use the full group, including accounts hidden by search. */
export const AccountGroup = (props: {
  readonly kind: AccountProfile['kind']
  readonly accounts: readonly AccountProfile[]
  readonly visibleIds: readonly string[]
  readonly selectedId: string | null
  readonly onSelect: (instanceId: string) => void
  readonly onToggle: (profile: AccountProfile) => void
  readonly onMove: (instanceId: string, direction: AccountOrderDirection) => void
  readonly reorderingDisabled: boolean
}): JSX.Element | null => {
  if (!props.accounts.some(account => props.visibleIds.includes(account.instanceId))) return null
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-2 dshx:pt-4">
      <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{KIND_LABEL[props.kind]}</h3>
      <ul aria-label={`${KIND_LABEL[props.kind]} accounts`} className="dshx:flex dshx:flex-col dshx:gap-2">
        {props.accounts.map((profile, index) => {
          if (!props.visibleIds.includes(profile.instanceId)) return null
          const isSelected = profile.instanceId === props.selectedId
          return (
            <li
              className={cn(
                'dshx:min-w-0 dshx:rounded-xl dshx:border dshx:bg-card dshx:p-3 dshx:transition-colors',
                isSelected ? 'dshx:border-primary dshx:bg-accent/40 dshx:ring-1 dshx:ring-primary/20' : 'dshx:hover:border-muted-foreground/40',
              )}
              key={profile.instanceId}
            >
              <div className="dshx:flex dshx:items-start dshx:gap-2">
                <button
                  aria-current={isSelected ? 'true' : undefined}
                  className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3 dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
                  onClick={() => props.onSelect(profile.instanceId)}
                  type="button"
                >
                  <ProviderGlyph kind={profile.kind} />
                  <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
                    <strong className="dshx:truncate dshx:text-sm dshx:font-semibold">{profile.displayName}</strong>
                    <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                      {profile.identity ?? (profile.signedIn ? 'Signed in' : 'Not signed in')}
                    </span>
                  </span>
                </button>
                <ActionHint label={profile.enabled ? 'Disable account' : 'Enable account'}>
                  <Switch
                    aria-label={
                      routedKind(profile.kind)
                        ? `${profile.enabled ? 'Hide' : 'Show'} ${profile.displayName} in the model picker`
                        : `${profile.enabled ? 'Disable' : 'Enable'} quota tracking for ${profile.displayName}`
                    }
                    checked={profile.enabled}
                    onCheckedChange={() => props.onToggle(profile)}
                    size="sm"
                  />
                </ActionHint>
              </div>
              <div className="dshx:mt-3 dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs">
                <span className={cn('dshx:flex dshx:items-center dshx:gap-1.5', profile.signedIn ? 'dshx:text-success' : 'dshx:text-muted-foreground')}>
                  <span aria-hidden className="dshx:size-1.5 dshx:rounded-full dshx:bg-current" />
                  {profile.state === 'cooling' ? STATE_LABEL.cooling : profile.signedIn ? 'Credentials available' : 'Not signed in'}
                </span>
                {profile.plan === null ? null : (
                  <span className="dshx:max-w-28 dshx:truncate dshx:rounded-md dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:text-muted-foreground">
                    {profile.plan}
                  </span>
                )}
                {!profile.enabled ? <span className="dshx:text-muted-foreground">Disabled</span> : null}
                {routedKind(profile.kind) ? (
                  <div className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-0.5">
                    <span className="dshx:mr-1 dshx:text-muted-foreground">#{index + 1}</span>
                    <ActionHint label="Move earlier in account order">
                      <Button
                        aria-label={`Move ${profile.displayName} earlier in account order`}
                        disabled={index === 0 || props.reorderingDisabled}
                        onClick={() => props.onMove(profile.instanceId, 'earlier')}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUpIcon />
                      </Button>
                    </ActionHint>
                    <ActionHint label="Move later in account order">
                      <Button
                        aria-label={`Move ${profile.displayName} later in account order`}
                        disabled={index === props.accounts.length - 1 || props.reorderingDisabled}
                        onClick={() => props.onMove(profile.instanceId, 'later')}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDownIcon />
                      </Button>
                    </ActionHint>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
