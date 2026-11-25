import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon, PencilIcon, RefreshCwIcon, Settings2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountLabels, KIND_LABEL } from './account-labels.js'
import type { AccountOrderDirection, AccountProfile, AccountsUsage } from './api.js'
import { ActionHint, ProviderGlyph } from './panel-primitives.js'
import { AccountConnection, type AccountSection } from './account-connection-status.js'
import { HealthDot, healthTextClass } from '@dshfiles/plugin-ui/components/ui/status-dot'

/**
 * Selection is cosmetic; ordering always uses the full canonical provider group. A row only selects (brand tile, name,
 * one health dot, its `⋯`): the picker switch, rename and the Models / Settings / Usage sections live once, in the
 * detail (round five P5).
 */
export const AccountGroup = (props: {
  readonly kind: AccountProfile['kind']
  readonly accounts: readonly AccountProfile[]
  readonly visibleIds: readonly string[]
  readonly selectedId: string | null
  readonly onSelect: (instanceId: string) => void
  readonly onMove: (instanceId: string, direction: AccountOrderDirection) => void
  readonly reorderingDisabled: boolean
  readonly usage?: AccountsUsage | null
  readonly onSection?: (instanceId: string, section: AccountSection) => void
  readonly onRename?: (instanceId: string) => void
  readonly onConnect?: (instanceId: string) => void
}): JSX.Element | null => {
  if (!props.accounts.some(account => props.visibleIds.includes(account.instanceId))) return null
  return (
    <section aria-label={`${KIND_LABEL[props.kind]} accounts`}>
      <ul className="dshx:flex dshx:flex-col dshx:gap-2">
        {props.accounts.map((profile, index) => {
          if (!props.visibleIds.includes(profile.instanceId)) return null
          const selected = profile.instanceId === props.selectedId
          const status = AccountConnection.status(profile, props.usage ?? null)
          const identity = [profile.plan === null ? null : AccountLabels.planLabel(profile.plan), profile.identity].filter(Boolean).join(' · ')
          const signIn = profile.signedIn ? 'Credentials available' : 'Not signed in'
          return (
            <li
              data-account-priority={index + 1}
              key={profile.instanceId}
              className={cn(
                'dshx:min-w-0 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border/60 dshx:bg-card dshx:transition-colors',
                !selected && 'dshx:hover:border-muted-foreground/40',
              )}
            >
              <div className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:px-3 dshx:py-3', selected && 'dshx:bg-selected-wash dshx:text-foreground')}>
                <button
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`Select ${profile.displayName}`}
                  className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-3 dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
                  onClick={() => props.onSelect(profile.instanceId)}
                  type="button"
                >
                  <ProviderGlyph kind={profile.kind} />
                  <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
                    <strong className="dshx:truncate dshx:text-sm dshx:font-semibold">{profile.displayName}</strong>
                    <span className="dshx:truncate dshx:text-2xs dshx:text-muted-foreground">{identity || signIn}</span>
                  </span>
                </button>
                {/* One health dot. Healthy is only the dot; a limited or down account also names its state in the dot's colour. */}
                {status.health === 'limited' || status.health === 'down' ? (
                  <ActionHint label={status.detail ?? status.label}>
                    <span className={cn('dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-2xs', healthTextClass[status.health])}>
                      <HealthDot health={status.health} />
                      {status.label}
                    </span>
                  </ActionHint>
                ) : identity !== '' && status.label === 'Not signed in' ? (
                  <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-2xs dshx:text-muted-foreground">
                    <HealthDot health={status.health} />
                    {status.label}
                  </span>
                ) : (
                  <HealthDot aria-label={status.label} health={status.health} />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-label={`Actions for ${profile.displayName}`} size="icon-xs" type="button" variant="ghost">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => props.onRename?.(profile.instanceId)}>
                      <PencilIcon />
                      Rename account
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onConnect?.(profile.instanceId)}>
                      <RefreshCwIcon />
                      Reauthenticate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onSection?.(profile.instanceId, 'settings')}>
                      <Settings2Icon />
                      Account settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      aria-label={`Move ${profile.displayName} earlier in account order`}
                      disabled={index === 0 || props.reorderingDisabled}
                      onSelect={() => props.onMove(profile.instanceId, 'earlier')}
                    >
                      <ArrowUpIcon />
                      Move earlier · #{index + 1}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      aria-label={`Move ${profile.displayName} later in account order`}
                      disabled={index === props.accounts.length - 1 || props.reorderingDisabled}
                      onSelect={() => props.onMove(profile.instanceId, 'later')}
                    >
                      <ArrowDownIcon />
                      Move later
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
