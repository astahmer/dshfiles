import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { AttentionBadge } from '@dshfiles/plugin-ui/components/ui/attention-badge'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { PlaceGlyph, type PlaceTone } from '@dshfiles/plugin-ui/components/ui/place-glyph'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { HealthDot, StatusDot, healthTextClass } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { UnitInput } from '@dshfiles/plugin-ui/components/ui/unit-input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { DiffStat } from '@dshfiles/plugin-ui/components/diff-stat'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { LoadError } from '@dshfiles/plugin-ui/components/load-error'
import { StatusCount, workStatusValues, workStatusLabels } from '@dshfiles/plugin-ui/components/work-status'
import {
  ActivityIcon,
  BotIcon,
  GitMergeIcon,
  InboxIcon,
  LibraryIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  TrashIcon,
} from '@dshfiles/plugin-ui/icons'
import type { GalleryDemo } from './types.js'

const row = 'dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2'

function ControlsDemo() {
  const [on, setOn] = React.useState(true)
  const [checked, setChecked] = React.useState(true)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <Input placeholder="Text input" aria-label="Text input" />
      <div className={row}>
        <Select defaultValue="system">
          <SelectTrigger aria-label="Theme" className="dshx:min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Match system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
        <UnitInput aria-label="Font size" unit="px" defaultValue={14} className="dshx:w-24" />
      </div>
      <div className={row}>
        <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
          <Switch checked={on} onCheckedChange={setOn} /> Switch
        </label>
        <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
          <Checkbox checked={checked} onCheckedChange={value => setChecked(value === true)} /> Checkbox
        </label>
      </div>
      <ToggleGroup type="single" defaultValue="day" variant="outline" size="sm" aria-label="Range">
        <ToggleGroupItem value="day">Day</ToggleGroupItem>
        <ToggleGroupItem value="week">Week</ToggleGroupItem>
        <ToggleGroupItem value="month">Month</ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

/** Each colour role as a swatch (DESIGN.md › Colour roles); classes are literal so Tailwind keeps them. */
const roleSwatches = {
  'Attention and result': [
    ['status-needs-you', 'dshx:bg-status-needs-you'],
    ['status-failed', 'dshx:bg-status-failed'],
    ['status-ready', 'dshx:bg-status-ready'],
    ['status-working', 'dshx:bg-status-working'],
    ['status-idle', 'dshx:bg-status-idle'],
    ['status-done', 'dshx:bg-status-done'],
    ['control-on', 'dshx:bg-control-on'],
  ],
  'Tint rung': [
    ['selected-wash', 'dshx:bg-selected-wash'],
    ['wash-needs-you', 'dshx:bg-wash-needs-you'],
    ['wash-needs-you-band', 'dshx:bg-wash-needs-you-band'],
    ['wash-failed', 'dshx:bg-wash-failed'],
    ['attention-tint', 'dshx:bg-attention-tint'],
    ['danger-tint', 'dshx:bg-danger-tint'],
  ],
  Identity: [
    ['identity-1', 'dshx:bg-identity-1'],
    ['identity-2', 'dshx:bg-identity-2'],
    ['identity-3', 'dshx:bg-identity-3'],
    ['identity-4', 'dshx:bg-identity-4'],
    ['identity-5', 'dshx:bg-identity-5'],
    ['identity-6', 'dshx:bg-identity-6'],
    ['identity-7', 'dshx:bg-identity-7'],
    ['identity-8', 'dshx:bg-identity-8'],
  ],
  Data: [
    ['data-1', 'dshx:bg-data-1'],
    ['data-2', 'dshx:bg-data-2'],
    ['data-3', 'dshx:bg-data-3'],
    ['data-4', 'dshx:bg-data-4'],
    ['data-5', 'dshx:bg-data-5'],
    ['data-6', 'dshx:bg-data-6'],
  ],
} as const

const identityText = [
  'dshx:text-identity-1',
  'dshx:text-identity-2',
  'dshx:text-identity-3',
  'dshx:text-identity-4',
  'dshx:text-identity-5',
  'dshx:text-identity-6',
  'dshx:text-identity-7',
  'dshx:text-identity-8',
] as const

const cardChoices = ['Warm stone', 'Neutral', 'High contrast'] as const

/** A chosen card (`selected-card`: 1.5px edge in the ink at 80% and an ink check on its own surface) beside a selected list row (wash, marker, 550). */
function SelectionDemo() {
  const [chosen, setChosen] = React.useState<string>(cardChoices[0])
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <div role="radiogroup" aria-label="Theme" className="dshx:grid dshx:grid-cols-3 dshx:gap-2">
        {cardChoices.map(choice => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={chosen === choice}
            onClick={() => setChosen(choice)}
            className={`dshx:flex dshx:h-16 dshx:items-end dshx:rounded-lg dshx:border dshx:p-2 dshx:bg-background dshx:text-left dshx:text-sm ${chosen === choice ? 'dshx:selected-card dshx:font-selected' : 'dshx:border-border'}`}
          >
            {choice}
          </button>
        ))}
      </div>
      <EntityList>
        <EntityRow role="listitem" heading="Selected row" selected onSelect={() => undefined} />
        <EntityRow role="listitem" heading="Another row" onSelect={() => undefined} />
      </EntityList>
    </div>
  )
}

/** The rail destinations and their navigation tones (`PlaceTone`). */
const navItems = [
  ['Threads', MessagesSquareIcon, 'threads'],
  ['Inbox', InboxIcon, 'inbox'],
  ['Land', GitMergeIcon, 'land'],
  ['Work', ListTodoIcon, 'work'],
  ['Agents', BotIcon, 'agents'],
  ['Observe', ActivityIcon, 'observe'],
  ['Knowledge', LibraryIcon, 'knowledge'],
  ['Settings', SettingsIcon, 'settings'],
] as const satisfies ReadonlyArray<readonly [string, unknown, PlaceTone]>

/** Settings groups take an identity tone as their place tone (settings-shell's group ramp). */
const settingsItems = [
  ['General', SettingsIcon, 'var(--dshx-identity-7)'],
  ['Models & accounts', BotIcon, 'var(--dshx-identity-2)'],
  ['Tools & MCP', ListTodoIcon, 'var(--dshx-identity-3)'],
  ['Plugins', LibraryIcon, 'var(--dshx-identity-1)'],
] as const

const placeRow = (selected: boolean): string =>
  `dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1 dshx:text-left dshx:text-sm dshx:hover:bg-accent ${selected ? 'dshx:bg-selected-wash dshx:selected-marker dshx:font-selected dshx:text-foreground' : 'dshx:text-muted-foreground'}`

/**
 * A selected place carries its tone (council round 9 A1): every glyph in its tone; the current one sits on its 14% tile
 * (`PlaceGlyph` follows the row's `aria-current`), with the neutral wash, ink marker and label of a selected row.
 */
function NavToneDemo() {
  const [current, setCurrent] = React.useState<string>('Threads')
  const [group, setGroup] = React.useState<string>('General')
  return (
    <div className="dshx:flex dshx:flex-wrap dshx:gap-3">
      <nav aria-label="Destinations" className="dshx:flex dshx:w-44 dshx:flex-col dshx:gap-0.5 dshx:rounded-lg dshx:bg-card dshx:p-1.5">
        {navItems.map(([label, Icon, tone]) => (
          <button key={label} type="button" aria-current={current === label ? 'page' : undefined} onClick={() => setCurrent(label)} className={placeRow(current === label)}>
            <PlaceGlyph tone={tone}>
              <Icon aria-hidden />
            </PlaceGlyph>
            {label}
          </button>
        ))}
      </nav>
      <nav aria-label="Settings groups" className="dshx:flex dshx:w-52 dshx:flex-col dshx:gap-0.5 dshx:rounded-lg dshx:bg-card dshx:p-1.5">
        {settingsItems.map(([label, Icon, tone]) => (
          <button key={label} type="button" aria-current={group === label ? 'page' : undefined} onClick={() => setGroup(label)} className={placeRow(group === label)}>
            <PlaceGlyph toneColor={tone}>
              <Icon aria-hidden strokeWidth={1.5} />
            </PlaceGlyph>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

const healthLabels = { ok: 'Connected', limited: 'Rate limited', down: 'Signed out', off: 'Off' } as const

/** One project per tone, in palette order, so each of the six project hues shows as a mark. */
const projectNames = ['billing-api', 'web-app', 'docs-site', 'dshfiles', 'mobile shell', 'infra'] as const

function ColourRolesDemo() {
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4">
      {Object.entries(roleSwatches).map(([group, swatches]) => (
        <section key={group} aria-label={group} className="dshx:flex dshx:flex-col dshx:gap-1.5">
          <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{group}</h3>
          <div className="dshx:flex dshx:flex-wrap dshx:gap-3">
            {swatches.map(([name, swatch]) => (
              <span key={name} className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:font-mono dshx:text-2xs dshx:text-muted-foreground">
                <span aria-hidden className={`dshx:size-4 dshx:rounded-sm ${swatch}`} />
                {name}
              </span>
            ))}
          </div>
        </section>
      ))}
      <section aria-label="Identity text" className="dshx:flex dshx:flex-wrap dshx:gap-3 dshx:text-sm dshx:font-medium">
        {identityText.map((tone, index) => (
          <span key={tone} className={tone}>
            Project {index + 1}
          </span>
        ))}
      </section>
      <section aria-label="Projects" className="dshx:flex dshx:flex-wrap dshx:gap-4 dshx:text-sm">
        {projectNames.map((name, tone) => (
          <span key={name} className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
            <ProjectMark name={name} tone={tone} />
            {name}
            <ProjectMark name={name} tone={tone} size="dense" />
          </span>
        ))}
      </section>
      <section aria-label="Health" className="dshx:flex dshx:flex-wrap dshx:gap-4 dshx:text-sm">
        {(['ok', 'limited', 'down', 'off'] as const).map(health => (
          <span key={health} className="dshx:flex dshx:items-center dshx:gap-1.5">
            <HealthDot health={health} />
            <span className={healthTextClass[health]}>{healthLabels[health]}</span>
          </span>
        ))}
      </section>
    </div>
  )
}

export const kitDemos: readonly GalleryDemo[] = [
  {
    id: 'kit-button',
    title: 'Button',
    description: 'One black primary per page; outline in headers, ghost in rows, the attention tint on a row verb that waits on you, its text rung on a row that already carries a wash.',
    source: "import { Button } from '@dshfiles/plugin-ui/components/ui/button'",
    static: true,
    render: () => (
      <div className={row}>
        <Button>
          <PlusIcon /> Primary
        </Button>
        <Button variant="outline">
          <RefreshCwIcon /> Outline
        </Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">
          <TrashIcon /> Destructive
        </Button>
        <Button size="xs" variant="attention">
          Review
        </Button>
        <Button size="xs" variant="danger-tint">
          Retry
        </Button>
        <Button size="xs" variant="attention-text">
          Answer
        </Button>
        <Button size="xs" variant="danger-text">
          Open
        </Button>
        <Button size="sm" variant="outline">
          Small
        </Button>
        <Button size="xs" variant="outline">
          XS
        </Button>
      </div>
    ),
  },
  {
    id: 'kit-badge',
    title: 'Badge and StatusDot',
    description: 'Semantic chips and the round status marker.',
    source: "import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-col dshx:gap-3">
        <div className={row}>
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="info">info</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
          <Badge variant="destructive">destructive</Badge>
        </div>
        <div className={row}>
          {(['current', 'success', 'warning', 'destructive', 'info', 'muted'] as const).map(tone => (
            <span key={tone} className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
              <StatusDot tone={tone} /> {tone}
            </span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'kit-work-status',
    title: 'StatusGlyph and EntityRow',
    description: 'The six work states and the shared list row.',
    source: "import { EntityRow } from '@dshfiles/plugin-ui/components/entity-row'",
    static: true,
    render: () => (
      <EntityList>
        {workStatusValues.map(status => (
          <EntityRow key={status} role="listitem" status={status} heading={workStatusLabels[status]} meta={<span>{status}</span>} selected={status === 'idle'} />
        ))}
      </EntityList>
    ),
  },
  {
    id: 'kit-status-count',
    title: 'StatusCount',
    description: 'A count that names its status with the glyph, so it reads without its colour.',
    source: "import { StatusCount } from '@dshfiles/plugin-ui/components/work-status'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3">
        {workStatusValues.map((status, index) => (
          <StatusCount key={status} status={status} count={index + 1} />
        ))}
      </div>
    ),
  },
  {
    id: 'kit-attention-badge',
    title: 'AttentionBadge',
    description: 'The Needs-you count on a nav glyph: a 16px attention pill ringed in its surface, seated beside the glyph.',
    source: "import { AttentionBadge } from '@dshfiles/plugin-ui/components/ui/attention-badge'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-6 dshx:rounded-lg dshx:bg-[var(--dsw-specific-sidebar-fill)] dshx:p-3">
        {[1, 12, 140].map(count => (
          <span key={count} className="dshx:relative dshx:inline-flex dshx:size-8 dshx:items-center dshx:justify-center">
            <InboxIcon aria-hidden className="dshx:size-4.5" />
            <AttentionBadge count={count} label="need you" className="dshx:absolute dshx:-top-1 dshx:left-5.5" />
          </span>
        ))}
      </div>
    ),
  },
  {
    id: 'kit-heading',
    title: 'Contextual heading',
    description: 'One step for in-page section headings: 15/20 at 600, between the 13px section title and the page title.',
    source: '<h3 className="dshx:text-heading">Appearance</h3>',
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-col dshx:gap-1">
        <h3 className="dshx:text-heading">Appearance</h3>
        <p className="dshx:text-sm dshx:text-muted-foreground">Theme, font and density for every surface.</p>
      </div>
    ),
  },
  {
    id: 'kit-diff-stat',
    title: 'DiffStat',
    description: 'One change count everywhere: +N then −N, tabular, a zero side muted.',
    source: "import { DiffStat } from '@dshfiles/plugin-ui/components/diff-stat'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-4">
        <DiffStat added={48} removed={3} />
        <DiffStat added={12} removed={0} />
        <DiffStat added={0} removed={207} />
        <DiffStat added={1204} removed={2400} />
      </div>
    ),
  },
  {
    id: 'kit-colour-roles',
    title: 'Colour roles',
    description: 'Attention, result, identity and data: the four jobs colour has, the project mark and the health dot.',
    source: "import { HealthDot } from '@dshfiles/plugin-ui/components/ui/status-dot'",
    static: true,
    wide: true,
    render: () => <ColourRolesDemo />,
  },
  {
    id: 'kit-selection',
    title: 'Selection',
    description: 'A neutral wash: a chosen card takes the ring edge and a check, a selected row the leading marker.',
    source: "className={chosen ? 'dshx:selected-card' : undefined}",
    static: true,
    render: () => <SelectionDemo />,
  },
  {
    id: 'kit-nav-tones',
    title: 'Navigation tones',
    description: 'A selected place carries its tone: each glyph in its tone, the current one on a 14% tile of it; the wash, marker and label stay neutral.',
    source: "<PlaceGlyph tone='threads'><Icon /></PlaceGlyph> · <PlaceGlyph toneColor='var(--dshx-identity-7)' selected />",
    static: true,
    render: () => <NavToneDemo />,
  },
  {
    id: 'kit-controls',
    title: 'Inputs and toggles',
    description: 'One field look for Input, Select and UnitInput (the unit inside the field), then Switch, Checkbox, ToggleGroup.',
    source: "import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'",
    static: true,
    render: () => <ControlsDemo />,
  },
  {
    id: 'kit-feedback',
    title: 'Progress, Spinner, Skeleton',
    description: 'Loading and progress feedback.',
    source: "import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-col dshx:gap-3">
        <Progress value={62} aria-label="Progress" />
        <div className={row}>
          <Spinner /> <span className="dshx:text-sm dshx:text-muted-foreground">Loading…</span>
        </div>
        <Skeleton className="dshx:h-4 dshx:w-3/4" />
        <Skeleton className="dshx:h-4 dshx:w-1/2" />
      </div>
    ),
  },
  {
    id: 'kit-alert',
    title: 'Alert, Kbd, Tooltip',
    description: 'Inline notices, key hints and hover help.',
    source: "import { Alert } from '@dshfiles/plugin-ui/components/ui/alert'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-col dshx:gap-3">
        <Alert>
          <AlertTitle>Quota low</AlertTitle>
          <AlertDescription>Switch this thread to another account from the model picker.</AlertDescription>
        </Alert>
        <div className={row}>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline">
                Hover me
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tooltips instead of native title</TooltipContent>
          </Tooltip>
        </div>
      </div>
    ),
  },
  {
    id: 'kit-load-error',
    title: 'LoadError',
    description: 'A page or section that did not load: one sentence from errorSentence, Retry, and the cause under Details.',
    source: "import { LoadError } from '@dshfiles/plugin-ui/components/load-error'",
    static: true,
    render: () => (
      <div className="dshx:flex dshx:flex-col dshx:gap-2">
        <LoadError
          subject="Inbox"
          error={Object.assign(new Error('Internal Server Error'), { kind: 'transport', status: 500, endpoint: 'dshx-inbox/list' })}
          onRetry={() => undefined}
        />
        <LoadError subject="Inbox" error={new TypeError('Failed to fetch')} onRetry={() => undefined} />
      </div>
    ),
  },
]
