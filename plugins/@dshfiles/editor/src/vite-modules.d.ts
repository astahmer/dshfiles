declare module '*?worker&inline' {
  const WorkerFactory: new (options?: { readonly name?: string }) => Worker
  export default WorkerFactory
}

declare module 'virtual:dshfiles-monaco-css' {
  const css: string
  export default css
}
