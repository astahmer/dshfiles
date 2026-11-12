import { CommandKeys } from '@dshfiles/dshx/client'
import { cn } from '../../lib/utils.js'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'dshx:pointer-events-none dshx:inline-flex dshx:h-5 dshx:w-fit dshx:min-w-5 dshx:items-center dshx:justify-center dshx:gap-1 dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:font-sans dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:select-none',
        'dshx:[&_svg:not([class*=size-])]:size-3',
        'dshx:[[data-slot=tooltip-content]_&]:bg-background/20 dshx:[[data-slot=tooltip-content]_&]:text-background dshx:dark:[[data-slot=tooltip-content]_&]:bg-background/10',
        className,
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <kbd data-slot="kbd-group" className={cn('dshx:inline-flex dshx:items-center dshx:gap-1', className)} {...props} />
}

interface KeyHintProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  /** One key spec (`Mod+K`, `E`, `G I`) or several alternatives, as a dshx `Command`'s `keys` lists them. */
  readonly keys: string | readonly string[]
  /** Show at most this many alternatives; defaults to two. */
  readonly max?: number
  /** Force the macOS glyphs (⌘ ⌥ ⇧) or the Ctrl/Alt words; defaults to the current platform. */
  readonly mac?: boolean
}

/**
 * The keycaps of a binding, read from the same grammar the shortcut layer matches (`CommandKeys`), so a hint never
 * names a key that does something else. A sequence reads `G` then `I`; a run of digits reads `1–9`.
 */
/** `aria-keyshortcuts` for one or more key specs; undefined when none has an ARIA form (a `G I` sequence). */
const keysAria = (keys: string | readonly string[] | undefined): string | undefined => {
  if (keys === undefined) return undefined
  const spoken = (typeof keys === 'string' ? [keys] : keys).flatMap(spec => {
    const value = CommandKeys.aria(spec)
    return value === undefined ? [] : [value]
  })
  return spoken.length === 0 ? undefined : spoken.join(' ')
}

function KeyHint({ keys, max = 2, mac, className, ...props }: KeyHintProps) {
  const specs = CommandKeys.compact(typeof keys === 'string' ? [keys] : keys).slice(0, max)
  if (specs.length === 0) return null
  const onMac = mac ?? CommandKeys.currentIsMac()
  const label = specs
    .map(spec =>
      CommandKeys.keycaps(spec, onMac)
        .map(step => step.join(onMac ? '' : '+'))
        .join(' then '),
    )
    .join(' or ')
  return (
    <span
      data-slot="key-hint"
      aria-label={label}
      className={cn('dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:tabular-nums', className)}
      {...props}
    >
      {specs.map(spec => (
        <span key={spec} aria-hidden="true" className="dshx:inline-flex dshx:items-center dshx:gap-1">
          {CommandKeys.keycaps(spec, onMac).map((step, index) => (
            <KbdGroup key={`${spec}-${String(index)}`}>
              {step.map(cap => (
                <Kbd key={cap}>{cap}</Kbd>
              ))}
            </KbdGroup>
          ))}
        </span>
      ))}
    </span>
  )
}

export { Kbd, KbdGroup, KeyHint, keysAria }
export type { KeyHintProps }
