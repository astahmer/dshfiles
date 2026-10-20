import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'

export const UsagePlanBadge = (props: { readonly plan: string | null }): JSX.Element | null => {
  const plan = props.plan?.trim()
  if (!plan) return null
  return (
    <Badge
      aria-label={`Subscription plan: ${plan}`}
      className="dshx:h-5 dshx:min-w-0 dshx:max-w-[30%] dshx:shrink dshx:px-1.5 dshx:text-[10px]"
      title={`Subscription plan: ${plan}`}
      variant="secondary"
    >
      <span className="dshx:truncate">{plan}</span>
    </Badge>
  )
}
