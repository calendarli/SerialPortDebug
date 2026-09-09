const compiledSources = new Map<string, Promise<string>>()

export function compileProgramSource(source: string): Promise<string> {
  if (!source.trim()) return Promise.resolve(source)
  const cached = compiledSources.get(source)
  if (cached) return cached
  // JS is accepted by the TS parser too; share one lazy compiler and cache serial triggers.
  const task = import('./typescript-transpiler').then(({ transpileProgram }) =>
    transpileProgram(source)
  )
  compiledSources.set(source, task)
  if (compiledSources.size > 32) compiledSources.delete(compiledSources.keys().next().value!)
  void task.catch(() => {
    if (compiledSources.get(source) === task) compiledSources.delete(source)
  })
  return task
}
