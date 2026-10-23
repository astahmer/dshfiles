const Panel = (props: { readonly title: string }): JSX.Element => <h1>{props.title}</h1>
export const semanticTitle = <Panel title="Backlog" />
