// Import only this service's generated namespace; Worker globals stay outside Electron's ambient scope.
declare module 'cloudflare:workers' {
  const DurableObject: typeof import('../worker-configuration').CloudflareWorkersModule.DurableObject;
  type DurableObject<Env = unknown, Props = {}> = import('../worker-configuration').CloudflareWorkersModule.DurableObject<Env, Props>;
  export { DurableObject };
}
