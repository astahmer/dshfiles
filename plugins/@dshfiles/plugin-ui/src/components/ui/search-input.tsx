import { SearchIcon } from 'lucide-react'
import * as React from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from './input-group.js'

/** The input group with a leading search glyph. `className` sizes the group; every other prop and the ref go to the input. */
export const SearchInput = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(function SearchInput({ className, ...props }, ref) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput ref={ref} {...props} />
    </InputGroup>
  )
})
