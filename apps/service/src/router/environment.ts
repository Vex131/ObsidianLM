export function createManagedRouterEnvironment(baseEnvironment: NodeJS.ProcessEnv, controlledCachePath: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(Object.entries(baseEnvironment).filter(([name]) => !name.toUpperCase().startsWith("LLAMA_")));
  environment.LLAMA_CACHE = controlledCachePath;
  return environment;
}
