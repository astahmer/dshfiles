declare module '*?worker&inline' {
  const WorkerFactory: new (options?: { readonly name?: string }) => Worker
  export default WorkerFactory
}
