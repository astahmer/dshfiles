import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowDownIcon, ArrowUpIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountDraftModel } from './account-draft.js'
import { KIND_LABEL, STATE_LABEL, routedKind } from './account-labels.js'
import type { AccountOrderDirection, AccountProfile } from './api.js'
import { ProviderMark } from './panel-primitives.js'

/** One group of the rail: a provider heading and the accounts under it. */
export const AccountGroup = (props: {
  readonly kind: AccountProfile['kind']
  readonly accounts: readonly AccountProfile[]
  readonly selectedId: string | null
  readonly onSelect: (instanceId: string) => void
  readonly onToggle: (profile: AccountProfile) => void
  readonly onMove: (instanceId: string, direction: AccountOrderDirection) => void
  readonly reorderingDisabled: boolean
}): JSX.Element | null => {
  if (props.accounts.length === 0) return null
  return (
    <TooltipProvider delayDuration={500}>
    <section className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pt-2">
      <h2 className="dshx:px-2 dshx:pb-1 dshx:text-[11px] dshx:font-semibold dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">
        {KIND_LABEL[props.kind]}
      </h2>
      <ItemGroup className="dshx:gap-0.5">
        {props.accounts.map((profile, index) => {
          const isSelected = profile.instanceId === props.selectedId
          const firstInGroup = index === 0
          const lastInGroup = index === props.accounts.length - 1
          return (
            <Item
              className={cn('dshx:flex-nowrap dshx:gap-1 dshx:px-1 dshx:py-0.5 dshx:hover:bg-accent/50', isSelected && 'dshx:border-border dshx:bg-accent')}
              key={profile.instanceId}
              role="listitem"
              size="sm"
            >
              <button
                aria-current={isSelected ? 'true' : undefined}
                className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-0.5 dshx:py-1 dshx:text-left dshx:outline-none dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
                onClick={() => props.onSelect(profile.instanceId)}
                type="button"
              >
                <ProviderMark
                  badge={profile.badge === '' ? AccountDraftModel.badgeFromName(profile.displayName).slice(0, 2) : profile.badge}
                  color={profile.accentColor}
                />
                <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                  <ItemTitle className="dshx:block dshx:w-full dshx:truncate dshx:text-sm">{profile.displayName}</ItemTitle>
                  <ItemDescription className="dshx:line-clamp-1 dshx:text-xs">{profile.identity ?? STATE_LABEL[profile.state]}</ItemDescription>
                </ItemContent>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="dshx:inline-flex dshx:shrink-0">
                    <Switch
                      aria-label={`${profile.enabled ? 'Hide' : 'Show'} ${profile.displayName} in the model picker`}
                      checked={profile.enabled}
                      onCheckedChange={() => props.onToggle(profile)}
                      size="sm"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{profile.enabled ? 'Hide from the model picker' : 'Show in the model picker'}</TooltipContent>
              </Tooltip>
              {routedKind(profile.kind) ? (
                <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={`Move ${profile.displayName} earlier in account order`}
                        disabled={firstInGroup || props.reorderingDisabled}
                        onClick={() => props.onMove(profile.instanceId, 'earlier')}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUpIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move earlier in account order</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={`Move ${profile.displayName} later in account order`}
                        disabled={lastInGroup || props.reorderingDisabled}
                        onClick={() => props.onMove(profile.instanceId, 'later')}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDownIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move later in account order</TooltipContent>
                  </Tooltip>
                </div>
              ) : null}
            </Item>
          )
        })}
      </ItemGroup>
    </section>
    </TooltipProvider>
  )
}
