import type { SavedCommand } from './types'
import type { CommandPhase } from './scripts/command-program'

type Session = {
  command: SavedCommand
  count: number
  mainTimer?: ReturnType<typeof setTimeout>
  companionTimer?: ReturnType<typeof setTimeout>
}
type Options = {
  getCommand: (id: number) => SavedCommand | undefined
  send: (command: SavedCommand, phase: CommandPhase, current: () => boolean) => Promise<boolean>
  onChange: (autoIds: Set<number>, holdIds: Set<number>) => void
  onError: (error: unknown) => void
}

// One queue per command orders asynchronous processing, writes and release packets.
// Session identity also prevents a cancelled send from restarting a timer after release.
export class CommandRunner {
  private sessions = new Map<number, Session>()
  private queues = new Map<number, Promise<boolean>>()

  constructor(private options: Options) {}

  private notify(): void {
    const auto = new Set<number>()
    const held = new Set<number>()
    for (const [id, session] of this.sessions) (session.command.autoSend ? auto : held).add(id)
    this.options.onChange(auto, held)
  }

  private current(session: Session): boolean {
    return this.sessions.get(session.command.id) === session
  }

  private enqueue(
    command: SavedCommand,
    phase: CommandPhase,
    current: () => boolean
  ): Promise<boolean> {
    const previous = this.queues.get(command.id) || Promise.resolve(true)
    const task = previous
      .catch(() => false)
      .then(() => (current() ? this.options.send(command, phase, current) : false))
    this.queues.set(command.id, task)
    const cleanup = (): void => {
      if (this.queues.get(command.id) === task) this.queues.delete(command.id)
    }
    void task.then(cleanup, cleanup)
    return task
  }

  isActive(id: number): boolean {
    return this.sessions.has(id)
  }

  start(command: SavedCommand): void {
    if (this.isActive(command.id)) return
    if (command.companion?.enabled && !this.attachedCommand(command)) {
      this.options.onError(new Error('附带指令不存在或引用了自身，请重新选择'))
      return
    }
    const session: Session = { command, count: 0 }
    this.sessions.set(command.id, session)
    this.notify()
    void this.sendMain(session)
  }

  private async sendMain(session: Session): Promise<void> {
    try {
      const success = await this.enqueue(session.command, 'press', () => this.current(session))
      if (!this.current(session)) return
      if (!success) return void this.stop(session.command.id)
      session.count++
      if (session.count === 1) await this.sendCompanion(session)
      if (!this.current(session) || !session.command.autoSend) return
      if (session.command.autoSendCount > 0 && session.count >= session.command.autoSendCount)
        return void this.stop(session.command.id)
      session.mainTimer = setTimeout(
        () => void this.sendMain(session),
        Math.max(1, session.command.autoSendInterval)
      )
    } catch (error) {
      if (this.current(session)) {
        this.options.onError(error)
        void this.stop(session.command.id)
      }
    }
  }

  private async sendCompanion(session: Session): Promise<void> {
    const companion = session.command.companion
    if (!companion?.enabled || !this.current(session)) return
    try {
      const success = await this.sendAttached(session.command, () => this.current(session))
      if (!this.current(session)) return
      if (!success) return void this.stop(session.command.id)
      if (companion.loop)
        session.companionTimer = setTimeout(
          () => void this.sendCompanion(session),
          Math.max(1, companion.interval)
        )
    } catch (error) {
      if (this.current(session)) {
        this.options.onError(error)
        void this.stop(session.command.id)
      }
    }
  }

  async stop(id: number, release = true): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    clearTimeout(session.mainTimer)
    clearTimeout(session.companionTimer)
    this.notify()
    if (release && session.command.releaseTemplate) {
      try {
        await this.enqueue(session.command, 'release', () => true)
      } catch (error) {
        this.options.onError(error)
      }
    }
  }

  stopAll(release = true, holdsOnly = false): void {
    for (const [id, session] of this.sessions)
      if (!holdsOnly || !session.command.autoSend) void this.stop(id, release)
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.queues.values()])
  }

  sync(commands: SavedCommand[]): void {
    for (const [id, session] of this.sessions) {
      const next = commands.find((command) => command.id === id)
      // Parameter values may change live; changes to packet definitions end the old run.
      if (
        !next ||
        (next.companion?.enabled && !this.attachedCommand(next)) ||
        JSON.stringify({ ...next, parameters: [] }) !==
          JSON.stringify({ ...session.command, parameters: [] })
      )
        void this.stop(id)
      else session.command = next
    }
  }

  syncPorts(openedPorts: readonly string[]): void {
    for (const [id, session] of this.sessions) {
      const mainPort = session.command.targetPort
      const attachedPort = session.command.companion?.enabled
        ? this.attachedCommand(session.command)?.targetPort
        : undefined
      const mainOpen = !mainPort || openedPorts.includes(mainPort)
      if (!mainOpen || (attachedPort && !openedPorts.includes(attachedPort)))
        void this.stop(id, mainOpen)
    }
  }

  async sendOnce(command: SavedCommand, current: () => boolean): Promise<boolean> {
    if (command.companion?.enabled && !this.attachedCommand(command))
      throw new Error('附带指令不存在或引用了自身，请重新选择')
    if (!(await this.enqueue(command, 'press', current)) || !current()) return false
    return command.companion?.enabled ? this.sendAttached(command, current) : true
  }

  private sendAttached(command: SavedCommand, current: () => boolean): Promise<boolean> {
    const attached = this.attachedCommand(command)
    if (!attached) throw new Error('附带指令不存在或引用了自身，请重新选择')
    return this.enqueue(attached, 'companion', current)
  }

  private attachedCommand(command: SavedCommand): SavedCommand | undefined {
    if (command.companion?.source === 'custom')
      return command.companion.template
        ? {
            ...command,
            template: command.companion.template,
            companion: undefined,
            autoSend: false,
            releaseTemplate: ''
          }
        : undefined
    const id = command.companion?.commandId
    const attached = id !== null && id !== undefined ? this.options.getCommand(id) : undefined
    return attached?.id !== command.id ? attached : undefined
  }
}
