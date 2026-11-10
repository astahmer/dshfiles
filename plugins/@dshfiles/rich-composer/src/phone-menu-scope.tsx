import { useContract } from '@dshfiles/dshx/client'
import { useId, type ReactNode } from 'react'
import { PhoneThreadMenu, phoneMenuScope } from './phone-thread-menu.tsx'

export const PhoneMenuScope = (props: { readonly children: ReactNode }): ReactNode => {
  const readerId = useId()
  const contract = useContract(PhoneThreadMenu)
  const Scope = (contract.status === 'active' ? contract.value.scope : phoneMenuScope()).Provider
  return <Scope value={readerId}>{props.children}</Scope>
}
