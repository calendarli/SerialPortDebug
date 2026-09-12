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
  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : result.signal
        ? `terminated by ${result.signal}`
        : `exited with ${result.status}`
    const details = quiet
      ? [result.stdout?.toString().trim(), result.stderr?.toString().trim()].filter(Boolean)
      : []
    throw new Error(
      [
        `${command} ${reason}`,
        `Command: ${[command, ...args].map((arg) => JSON.stringify(arg)).join(' ')}`,
        `Working directory: ${cwd}`,
        ...details
      ].join('\n'),
      { cause: result.error }
    )
  }
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
