import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { workStatusValues, workStatusLabels } from '@dshfiles/plugin-ui/components/work-status'
import { PlusIcon, RefreshCwIcon, TrashIcon } from '@dshfiles/plugin-ui/icons'
import type { GalleryDemo } from './types.js'

const row = 'dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2'

function ControlsDemo() {
  const [on, setOn] = React.useState(true)
  const [checked, setChecked] = React.useState(true)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <Input placeholder="Text input" aria-label="Text input" />
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

export const kitDemos: readonly GalleryDemo[] = [
  {
    id: 'kit-button',
    title: 'Button',
    description: 'One black primary per page; outline in headers, ghost in rows.',
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
          <EntityRow key={status} role="listitem" status={status} heading={workStatusLabels[status]} meta={<span>{status}</span>} />
        ))}
      </EntityList>
    ),
  },
  {
    id: 'kit-controls',
    title: 'Inputs and toggles',
    description: 'Input, Switch, Checkbox, ToggleGroup.',
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
]
