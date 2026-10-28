import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  Settings2Icon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import { KIND_LABEL, routedKind } from './account-labels.js'
import type { AccountOrderDirection, AccountProfile, AccountsUsage } from './api.js'
import { ActionHint, ProviderGlyph } from './panel-primitives.js'
import { accountConnectionStatus, type AccountSection } from './account-connection-status.js'

/** Selection is cosmetic; ordering always uses the full canonical provider group. */
export const AccountGroup = (props: {
  readonly kind: AccountProfile['kind']
  readonly accounts: readonly AccountProfile[]
  readonly visibleIds: readonly string[]
  readonly selectedId: string | null
  readonly onSelect: (instanceId: string) => void
  readonly onToggle: (profile: AccountProfile) => void
  readonly onMove: (instanceId: string, direction: AccountOrderDirection) => void
  readonly reorderingDisabled: boolean
  readonly usage?: AccountsUsage | null
  readonly activeSection?: AccountSection
  readonly onSection?: (instanceId: string, section: AccountSection) => void
  readonly onRename?: (instanceId: string) => void
  readonly onConnect?: (instanceId: string) => void
}): JSX.Element | null => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (!props.accounts.some(account => props.visibleIds.includes(account.instanceId))) return null
  return (
    <section aria-label={`${KIND_LABEL[props.kind]} accounts`}>
      <ul className="dshx:flex dshx:flex-col dshx:gap-2">
        {props.accounts.map((profile, index) => {
          if (!props.visibleIds.includes(profile.instanceId)) return null
          const selected = profile.instanceId === props.selectedId
          const open = expanded[profile.instanceId] ?? (selected && props.activeSection === 'models')
          const status = accountConnectionStatus(profile, props.usage ?? null)
          return (
            <li
              data-account-priority={index + 1}
              key={profile.instanceId}
              className={cn(
                'dshx:min-w-0 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:bg-card dshx:transition-colors',
                selected ? 'dshx:border-info/60 dshx:ring-1 dshx:ring-info/10' : 'dshx:border-border/60 dshx:hover:border-muted-foreground/40',
              )}
            >
              <div
                className={cn(
                  'dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:border-l-[3px] dshx:px-3 dshx:py-3',
                  selected ? 'dshx:border-l-info dshx:bg-info/5' : 'dshx:border-l-transparent',
                )}
              >
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
                    <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
                      {[profile.plan, profile.identity].filter(Boolean).join(' · ') || (profile.signedIn ? 'Credentials available' : 'Not signed in')}
                    </span>
                  </span>
                </button>
                {selected ? (
                  <Button
                    aria-label={`Rename ${profile.displayName}`}
                    className="dshx:@max-pane-narrow:hidden"
                    onClick={() => props.onRename?.(profile.instanceId)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <PencilIcon className="dshx:size-3" />
                  </Button>
                ) : null}
                <ActionHint label={status.detail ?? status.label}>
                  <span
                    className={cn(
                      'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:text-[11px]',
                      status.tone === 'success' ? 'dshx:text-success' : status.tone === 'warning' ? 'dshx:text-warning' : 'dshx:text-muted-foreground',
                    )}
                  >
                    <span aria-hidden className="dshx:size-2 dshx:rounded-full dshx:bg-current" />
                    <span className={status.tone === 'warning' ? undefined : 'dshx:@max-pane-narrow:hidden'}>{status.label}</span>
                  </span>
                </ActionHint>
                <Switch
                  aria-label={
                    routedKind(profile.kind)
                      ? `${profile.enabled ? 'Hide' : 'Show'} ${profile.displayName} in the model picker`
                      : `${profile.enabled ? 'Disable' : 'Enable'} quota tracking for ${profile.displayName}`
                  }
                  checked={profile.enabled}
                  className="dshx:shrink-0 dshx:data-[state=checked]:bg-info"
                  onCheckedChange={() => props.onToggle(profile)}
                  size="sm"
                />
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
                <Button
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${profile.displayName} sections`}
                  aria-expanded={open}
                  className="dshx:shrink-0"
                  onClick={() => setExpanded(current => ({ ...current, [profile.instanceId]: !open }))}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </Button>
              </div>
              {open ? (
                <nav aria-label={`${profile.displayName} sections`} className="dshx:border-t dshx:bg-background/60">
                  {(
                    [
                      {
                        id: 'models',
                        label: 'Models',
                        Icon: LayersIcon,
                        detail: `${profile.favoriteModelIds.length} favorites · ${profile.hiddenModelIds.length} hidden`,
                      },
                      { id: 'settings', label: 'Settings', Icon: Settings2Icon, detail: `Priority ${index + 1} · ${KIND_LABEL[profile.kind]}` },
                      { id: 'usage', label: 'Usage', Icon: BarChart3Icon, detail: 'Activity and subscription quota' },
                    ] as const
                  ).map(item => (
                    <button
                      aria-current={selected && props.activeSection === item.id ? 'page' : undefined}
                      className="dshx:flex dshx:w-full dshx:items-center dshx:gap-3 dshx:border-b dshx:px-5 dshx:py-2.5 dshx:text-left dshx:text-xs dshx:last:border-b-0 dshx:hover:bg-accent"
                      key={item.id}
                      onClick={() => props.onSection?.(profile.instanceId, item.id)}
                      type="button"
                    >
                      <item.Icon className="dshx:size-4 dshx:text-muted-foreground" />
                      <span>{item.label}</span>
                      <span className="dshx:ml-auto dshx:truncate dshx:text-[10px] dshx:text-muted-foreground">{item.detail}</span>
                      <ChevronRightIcon className="dshx:size-3 dshx:text-muted-foreground" />
                    </button>
                  ))}
                </nav>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
