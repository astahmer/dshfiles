import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'

/**
 * The Changes view's scope filter. It is a filter over one list, so it is the kit's plain `ToggleGroup`, the one
 * segmented style every page uses (DESIGN.md, Tabs); the outline variant drew a fourth tab style of bordered buttons.
 */
export const ChangesScopeSwitch = <Scope extends string>(props: {
  readonly scopes: readonly Scope[]
  readonly value: Scope
  readonly label: (scope: Scope) => string
  readonly onChange: (scope: Scope) => void
}): JSX.Element => (
  <ToggleGroup
    aria-label="Changes scope"
    className="dshx:max-w-full dshx:flex-wrap"
    onValueChange={value => {
      const scope = props.scopes.find(candidate => candidate === value)
      if (scope !== undefined) props.onChange(scope)
    }}
    size="sm"
    type="single"
    value={props.value}
  >
    {props.scopes.map(scope => (
      <ToggleGroupItem aria-label={props.label(scope)} className="dshx:px-2 dshx:text-xs" key={scope} value={scope}>
        {props.label(scope)}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)
