import { spawnSync } from 'node:child_process'

export function run(
  command: string,
  args: string[],
  cwd = process.cwd(),
  quiet = false,
  timeout = 600000
): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: quiet ? 'pipe' : 'inherit',
    windowsHide: true,
    timeout
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

export async function optional(name: string, action: () => void | Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    console.warn(
      `[optional] ${name} unavailable: ${error instanceof Error ? error.message : error}`
    )
  }
}
