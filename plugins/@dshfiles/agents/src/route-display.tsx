import { BrandMark, brandOfModel } from '@dshfiles/model-effort-picker/brand-mark'
import type { JSX } from 'react'

import type { AgentModelOption } from './dispatch.js'

export class RouteDisplay {
  /** Account providers prefix every model name with their instance id; under its provider the prefix says nothing. */
  static modelName(option: Pick<AgentModelOption, 'provider' | 'modelName'>): string {
    return option.modelName.startsWith(`${option.provider}/`) ? option.modelName.slice(option.provider.length + 1) : option.modelName
  }
}

export const RouteMark = (props: { readonly option: Pick<AgentModelOption, 'model' | 'modelName'> }): JSX.Element => (
  <BrandMark brand={brandOfModel({ id: props.option.model, name: props.option.modelName })} name={RouteDisplay.modelName({ ...props.option, provider: '' })} />
)

/** One route as the composer picker shows it: family mark, short model name, the account muted after it. */
export const RouteLabel = (props: { readonly option: AgentModelOption; readonly showAccount: boolean }): JSX.Element => (
  <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2" title={`${props.option.providerName} · ${RouteDisplay.modelName(props.option)}`}>
    <RouteMark option={props.option} />
    <span className="dshx:min-w-0 dshx:truncate">{RouteDisplay.modelName(props.option)}</span>
    {props.showAccount ? <span className="dshx:shrink-0 dshx:truncate dshx:text-2xs dshx:text-muted-foreground">{props.option.providerName}</span> : null}
  </span>
)
