import * as React from 'react'
import { animate, motionSafe, springs, staggers } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { ChevronDownIcon, ShieldIcon, LockIcon } from '../../icons.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js'
import { DrawnPath, FlowPath, useNodeLinks, type NodeLink } from './node-links.js'

export interface AccessSource {
  readonly id: string
  readonly label: string
  readonly detail?: string
  /** A lucide icon; without it the card shows `initials` in a round tile. */
  readonly icon?: React.ReactNode
  readonly initials?: string
}

export interface AccessLevel {
  readonly id: string
  readonly label: string
  /** Sources this level lets through. */
  readonly sourceIds: readonly string[]
  /** Public: no sign-in, no token. Rules at this level are open paths. */
  readonly open?: boolean
}

export interface AccessRule {
  readonly id: string
  /** "read", "update, delete". */
  readonly verb: string
  readonly levelId: string
  /** Whether this verb reaches the protected target (draws the right-hand link). Default true. */
  readonly reachesTarget?: boolean
}

export interface AccessNode {
  readonly label: string
  readonly detail?: string
  readonly icon?: React.ReactNode
}

export interface AccessTarget extends AccessNode {
  readonly fields?: readonly { readonly name: string; readonly type: string }[]
}

export interface AccessEvidence {
  readonly sourceId: string
  readonly title: string
  readonly items: readonly { readonly id: string; readonly tag: string; readonly label: string }[]
}

export interface AccessMapProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  readonly heading: string
  readonly subtitle?: string
  readonly sources: readonly AccessSource[]
  readonly gateway: AccessNode
  readonly rules: readonly AccessRule[]
  readonly levels: readonly AccessLevel[]
  readonly onRuleChange: (ruleId: string, levelId: string) => void
  readonly target: AccessTarget
  /** Small labels riding on a source's links ("255 signups"). */
  readonly edgeLabels?: Readonly<Record<string, string>>
  /** Recent hits shown under a source while one of its paths is open. */
  readonly evidence?: readonly AccessEvidence[]
}

/**
 * Who can reach a protected resource: sources on the left, the gateway's verbs with their access level in the middle,
 * the resource on the right. Links draw themselves in; a verb left open to everyone turns its whole route red with
 * traffic running along it, and the open-path count pops. Changing a level redraws the links. Tools, secrets and
 * MCP endpoints agents can reach.
 */
export function AccessMap({
  heading,
  subtitle,
  sources,
  gateway,
  rules,
  levels,
  onRuleChange,
  target,
  edgeLabels,
  evidence,
  className,
  ...props
}: AccessMapProps) {
  const mapRef = React.useRef<HTMLDivElement>(null)
  const level = (id: string) => levels.find(entry => entry.id === id)
  const openRules = new Set(rules.filter(rule => level(rule.levelId)?.open).map(rule => rule.id))
  const openSources = new Set<string>()

  const links: (NodeLink & { readonly open: boolean; readonly sourceId?: string })[] = []
  for (const rule of rules) {
    const granted = level(rule.levelId)?.sourceIds ?? []
    const open = openRules.has(rule.id)
    for (const sourceId of granted) {
      if (!sources.some(source => source.id === sourceId)) continue
      links.push({ id: `${sourceId}->${rule.id}`, from: `source:${sourceId}`, to: `rule:${rule.id}`, open, sourceId })
      if (open) openSources.add(sourceId)
    }
    if (rule.reachesTarget !== false) links.push({ id: `${rule.id}->target`, from: `rule:${rule.id}`, to: 'target', open })
  }
  const signature = links.map(link => link.id).join('|')
  const layout = useNodeLinks(mapRef, links, [signature])

  // One label per source, on its first link.
  const labelled = new Set<string>()
  const labels = links.flatMap(link => {
    if (link.sourceId === undefined || labelled.has(link.sourceId)) return []
    const text = edgeLabels?.[link.sourceId]
    const ends = layout.ends.get(link.id)
    if (text === undefined || ends === undefined) return []
    labelled.add(link.sourceId)
    return [{ id: link.id, text, open: link.open, x: (ends[0] + ends[2]) / 2, y: (ends[1] + ends[3]) / 2 }]
  })

  const sourcesRef = React.useRef<HTMLDivElement>(null)
  const middleRef = React.useRef<HTMLDivElement>(null)
  const targetRef = React.useRef<HTMLDivElement>(null)
  useEnter(sourcesRef, 'slideInLeft', { children: true, stagger: staggers.loose })
  useEnter(middleRef, 'popIn', { ...springs.smooth, delay: 0.1 })
  useEnter(targetRef, 'slideInRight', { delay: 0.2 })

  return (
    <section
      aria-label={heading}
      className={cn(
        'dshx:@container dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:overflow-hidden dshx:rounded-2xl dshx:border dshx:border-border dshx:bg-card dshx:p-4',
        className,
      )}
      {...props}
    >
      <header className="dshx:flex dshx:items-start dshx:gap-3">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
          <span className="dshx:truncate dshx:text-sm dshx:font-semibold dshx:text-foreground dshx:@max-pane-narrow:line-clamp-2 dshx:@max-pane-narrow:whitespace-normal">
            {heading}
          </span>
          {subtitle ? (
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:line-clamp-2 dshx:@max-pane-narrow:whitespace-normal">
              {subtitle}
            </span>
          ) : null}
        </div>
        <OpenCount count={openRules.size} />
      </header>

      {/* The map scrolls inside its own box when even the narrow layout cannot fit; it never widens the card. */}
      <div
        className="dshx:-mx-1 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:rounded-xl dshx:[scrollbar-width:thin]"
        style={{ backgroundImage: 'radial-gradient(var(--dsw-alias-border-l2) 1px, transparent 1px)', backgroundSize: '14px 14px' }}
      >
        <div
          ref={mapRef}
          className="dshx:relative dshx:flex dshx:min-w-fit dshx:items-center dshx:justify-between dshx:gap-8 dshx:px-2 dshx:py-6 dshx:@max-pane-compact:gap-6 dshx:@max-pane-narrow:gap-4 dshx:@max-pane-narrow:py-4"
        >
          <svg aria-hidden className="dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:size-full dshx:overflow-visible">
            {links.map(link => {
              const d = layout.paths.get(link.id) ?? ''
              return (
                <g
                  key={link.id}
                  className={cn('dshx:transition-colors dshx:duration-300', link.open ? 'dshx:text-destructive' : 'dshx:text-muted-foreground/45')}
                >
                  <DrawnPath d={d} drawKey={link.id} delay={0.25} stroke="currentColor" strokeWidth={link.open ? 1.5 : 1.1} />
                  {link.open ? <FlowPath d={d} stroke="currentColor" strokeWidth={3} strokeLinecap="round" opacity={0.75} /> : null}
                </g>
              )
            })}
            {links.map(link => {
              const ends = layout.ends.get(link.id)
              if (ends === undefined) return null
              return (
                <g key={`${link.id}:ends`} className={link.open ? 'dshx:text-destructive' : 'dshx:text-muted-foreground/60'}>
                  <circle cx={ends[0]} cy={ends[1]} r={2.5} className="dshx:fill-card" stroke="currentColor" strokeWidth={1.2} />
                  <circle cx={ends[2]} cy={ends[3]} r={2.5} className="dshx:fill-card" stroke="currentColor" strokeWidth={1.2} />
                </g>
              )
            })}
          </svg>
          {labels.map(label => (
            <span
              key={label.id}
              style={{ left: label.x, top: label.y }}
              className={cn(
                'dshx:pointer-events-none dshx:absolute dshx:z-10 dshx:-translate-x-1/2 dshx:-translate-y-1/2 dshx:rounded-full dshx:border dshx:bg-card dshx:px-1.5 dshx:py-px dshx:text-[10px] dshx:whitespace-nowrap dshx:@max-pane-narrow:hidden',
                label.open ? 'dshx:border-destructive/40 dshx:text-destructive' : 'dshx:border-border dshx:text-muted-foreground',
              )}
            >
              {label.text}
            </span>
          ))}

          <div
            ref={sourcesRef}
            className="dshx:relative dshx:flex dshx:w-[150px] dshx:shrink-0 dshx:flex-col dshx:gap-3 dshx:@max-pane-narrow:w-[112px] dshx:@max-pane-narrow:gap-2"
          >
            {sources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                open={openSources.has(source.id)}
                evidence={openSources.has(source.id) ? evidence?.find(entry => entry.sourceId === source.id) : undefined}
              />
            ))}
          </div>

          <div
            ref={middleRef}
            className="dshx:relative dshx:flex dshx:w-[180px] dshx:shrink-0 dshx:flex-col dshx:gap-1.5 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-2 dshx:shadow-sm dshx:@max-pane-narrow:w-[156px]"
          >
            <NodeHeading node={gateway} fallbackIcon={<ShieldIcon />} />
            {rules.map(rule => (
              <RuleRow key={rule.id} rule={rule} levels={levels} open={openRules.has(rule.id)} onChange={levelId => onRuleChange(rule.id, levelId)} />
            ))}
          </div>

          <div
            ref={targetRef}
            data-node-anchor="target"
            className="dshx:relative dshx:flex dshx:w-[140px] dshx:shrink-0 dshx:flex-col dshx:gap-1 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-2 dshx:shadow-sm dshx:@max-pane-narrow:hidden"
          >
            <NodeHeading node={target} fallbackIcon={<LockIcon />} />
            {target.fields?.map(field => (
              <span key={field.name} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:px-1 dshx:py-0.5 dshx:text-[11px]">
                <span className="dshx:min-w-0 dshx:truncate dshx:text-foreground">{field.name}</span>
                <span className="dshx:shrink-0 dshx:text-muted-foreground/70">{field.type}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function OpenCount({ count }: { readonly count: number }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'popIn', springs.bouncy, count)
  return (
    <span
      ref={ref}
      role="status"
      className={cn(
        'dshx:shrink-0 dshx:rounded-full dshx:border dshx:px-2 dshx:py-0.5 dshx:text-[11px] dshx:font-medium',
        count > 0 ? 'dshx:border-destructive/50 dshx:text-destructive' : 'dshx:border-success/40 dshx:text-success',
      )}
    >
      {count === 0 ? 'No open paths' : count === 1 ? '1 open path' : `${count} open paths`}
    </span>
  )
}

function NodeHeading({ node, fallbackIcon }: { readonly node: AccessNode; readonly fallbackIcon: React.ReactNode }) {
  return (
    <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-1 dshx:pb-1">
      <span className="dshx:grid dshx:size-6 dshx:shrink-0 dshx:place-items-center dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted dshx:text-muted-foreground dshx:[&_svg]:size-3.5">
        {node.icon ?? fallbackIcon}
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-col">
        <span className="dshx:truncate dshx:text-xs dshx:font-semibold dshx:text-foreground">{node.label}</span>
        {node.detail ? <span className="dshx:truncate dshx:text-[10px] dshx:text-muted-foreground">{node.detail}</span> : null}
      </span>
    </div>
  )
}

function SourceCard({ source, open, evidence }: { readonly source: AccessSource; readonly open: boolean; readonly evidence: AccessEvidence | undefined }) {
  const evidenceRef = React.useRef<HTMLUListElement>(null)
  useEnter(evidenceRef, 'riseIn', { children: true, stagger: staggers.base, delay: 0.2 }, evidence?.items.length ?? 0)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <div
        data-node-anchor={`source:${source.id}`}
        className={cn(
          'dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-2 dshx:shadow-xs dshx:transition-colors dshx:duration-300',
          open ? 'dshx:border-destructive/50 dshx:bg-destructive/5' : 'dshx:border-border',
        )}
      >
        <span
          className={cn(
            'dshx:grid dshx:size-6 dshx:shrink-0 dshx:place-items-center dshx:text-[9px] dshx:font-semibold dshx:[&_svg]:size-3.5',
            source.icon ? 'dshx:rounded-md dshx:bg-muted' : 'dshx:rounded-full dshx:bg-foreground dshx:text-background',
            source.icon && (open ? 'dshx:text-destructive' : 'dshx:text-muted-foreground'),
          )}
        >
          {source.icon ?? source.initials ?? source.label.slice(0, 2).toUpperCase()}
        </span>
        <span className="dshx:flex dshx:min-w-0 dshx:flex-col">
          <span className="dshx:truncate dshx:text-xs dshx:font-medium dshx:text-foreground">{source.label}</span>
          {source.detail ? <span className="dshx:truncate dshx:text-[10px] dshx:text-muted-foreground">{source.detail}</span> : null}
        </span>
      </div>
      {evidence ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:pl-0.5">
          <span className="dshx:text-[10px] dshx:font-medium dshx:text-destructive">{evidence.title}</span>
          <ul ref={evidenceRef} className="dshx:flex dshx:flex-col dshx:gap-1">
            {evidence.items.map(item => (
              <li
                key={item.id}
                className="dshx:flex dshx:w-fit dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:py-0.5 dshx:pr-1.5 dshx:pl-0.5 dshx:text-[10px]"
              >
                <span className="dshx:rounded-[4px] dshx:bg-destructive/12 dshx:px-1 dshx:font-mono dshx:font-semibold dshx:text-destructive">{item.tag}</span>
                <span className="dshx:text-muted-foreground">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function RuleRow({
  rule,
  levels,
  open,
  onChange,
}: {
  readonly rule: AccessRule
  readonly levels: readonly AccessLevel[]
  readonly open: boolean
  readonly onChange: (levelId: string) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const current = levels.find(entry => entry.id === rule.levelId)
  const wasOpen = React.useRef(open)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (element == null || wasOpen.current === open) return
    wasOpen.current = open
    // A row that just opened gives a short warning nudge; one that closed settles.
    const controls = open
      ? animate(
          element,
          { transform: ['translateX(0px)', 'translateX(-3px)', 'translateX(3px)', 'translateX(-2px)', 'translateX(0px)'] },
          motionSafe({ duration: 0.36 }),
        )
      : animate(element, { transform: ['scale(0.97)', 'scale(1)'] }, motionSafe(springs.bouncy))
    return () => controls.complete()
  }, [open])
  return (
    <div
      ref={ref}
      data-node-anchor={`rule:${rule.id}`}
      className={cn(
        'dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:py-0.5 dshx:pr-0.5 dshx:pl-2 dshx:transition-colors dshx:duration-300',
        open ? 'dshx:border-destructive/60 dshx:bg-destructive/10' : 'dshx:border-transparent dshx:bg-muted',
      )}
    >
      <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[11px]', open ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}>
        {rule.verb}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${rule.verb}: ${current?.label ?? 'choose access'}`}
            className={cn(
              'dshx:flex dshx:h-6 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-[5px] dshx:px-1.5 dshx:text-[11px] dshx:font-medium dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:[&_svg]:size-3',
              open ? 'dshx:text-destructive' : 'dshx:text-foreground',
            )}
          >
            {current?.label ?? '—'}
            <ChevronDownIcon aria-hidden className="dshx:opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dshx:min-w-40">
          <DropdownMenuLabel className="dshx:text-xs dshx:text-muted-foreground">Who can {rule.verb}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={rule.levelId} onValueChange={onChange}>
            {levels.map(entry => (
              <DropdownMenuRadioItem key={entry.id} value={entry.id} className={cn('dshx:text-xs', entry.open && 'dshx:text-destructive')}>
                {entry.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
