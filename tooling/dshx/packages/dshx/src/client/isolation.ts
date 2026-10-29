import { Component, createElement, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { BrowserBroker } from './broker.js'

interface BoundaryProps {
  readonly owner: string
  readonly contributionId: string
  readonly children?: ReactNode
}

interface BoundaryState {
  readonly failed: boolean
}

/** Renders nothing in place of a contribution that threw, so its siblings and the slot keep rendering. */
const createBoundary = (): ComponentType<BoundaryProps> =>
  class ContributionBoundary extends Component<BoundaryProps, BoundaryState> {
    override state: BoundaryState = { failed: false }

    static getDerivedStateFromError(): BoundaryState {
      return { failed: true }
    }

    override componentDidCatch(error: unknown, info: ErrorInfo): void {
      BrowserBroker.reportFailure({ owner: this.props.owner, kind: 'component', id: this.props.contributionId, error })
      if (info.componentStack) console.error(info.componentStack)
    }

    override render(): ReactNode {
      return this.state.failed ? null : this.props.children
    }
  }

let boundary: ComponentType<BoundaryProps> | undefined

/** Defined on first render: a bundle evaluates before the Host hands it React. */
const contributionBoundary = (): ComponentType<BoundaryProps> => {
  boundary ??= createBoundary()
  return boundary
}

const isolatedComponents = new WeakMap<object, ComponentType<never>>()

/**
 * Wrap a contributed component in a failure boundary.
 *
 * The same component always maps to the same wrapper, so re-registering it does
 * not remount the subtree.
 */
const isolate = <Props extends object>(component: ComponentType<Props>, input: { readonly owner: string; readonly id: string }): ComponentType<Props> => {
  const existing = isolatedComponents.get(component)
  // Wrappers are stored per component, so the cached one has the same props.
  if (existing !== undefined) return existing as ComponentType<Props>
  const Isolated = (props: Props): ReactNode =>
    createElement(contributionBoundary(), { owner: input.owner, contributionId: input.id }, createElement(component, props))
  Isolated.displayName = `Isolated(${component.displayName ?? component.name ?? input.id})`
  isolatedComponents.set(component, Isolated)
  return Isolated
}

export class IsolationModel {
  static readonly isolate = isolate
}
