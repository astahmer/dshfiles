import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'

export const UsagePlanBadge = (props: { readonly plan: string | null }): JSX.Element | null => {
  const plan = props.plan?.trim()
  if (!plan) return null
  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="dshx:inline-flex dshx:min-w-0 dshx:max-w-[30%] dshx:shrink">
            <Badge
              aria-label={`Subscription plan: ${plan}`}
              className="dshx:h-5 dshx:min-w-0 dshx:max-w-full dshx:px-1.5 dshx:text-[10px]"
              variant="secondary"
            >
              <span className="dshx:truncate">{plan}</span>
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>{`Subscription plan: ${plan}`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
