import assert from 'node:assert/strict'
import { test, afterEach, jest } from 'bun:test'
import { CommandRunner } from '../src/renderer/src/command-runner'
import type { SavedCommand } from '../src/renderer/src/types'
import type { CommandPhase } from '../src/renderer/src/scripts/command-program'
type FixtureOptions = {
  command?: Partial<SavedCommand>
  beforeSend?: (command: SavedCommand, phase: CommandPhase) => unknown
}
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  jest.useRealTimers()
})
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

function fixture(options: FixtureOptions = {}) {
  jest.useFakeTimers()
  const query: SavedCommand = {
    parentId: null,
    hex: false,
    autoSendInterval: 100,
    autoSendCount: 0,
    parameters: [],
    id: 2,
    name: 'Query',
    template: 'READ',
    targetPort: 'COM2',
    autoSend: true,
    companion: {
      enabled: true,
      source: 'command',
      template: '',
      commandId: 1,
      loop: false,
      interval: 200
    }
  }
  const main: SavedCommand = {
    parentId: null,
    hex: false,
    id: 1,
    name: 'Move',
    template: 'LEFT',
    releaseTemplate: 'STOP',
    autoSend: false,
    autoSendInterval: 100,
    autoSendCount: 0,
    parameters: [],
    companion: {
      enabled: true,
      source: 'command',
      template: '',
      commandId: 2,
      loop: true,
      interval: 200
    },
    ...options.command
  }
  let commands = [main, query]
  const sent: [number, CommandPhase][] = []
  const errors: unknown[] = []
  const runner = new CommandRunner({
    getCommand: (id) => commands.find((command) => command.id === id),
    onChange: () => {},
    onError: (error) => errors.push(error),
    send: async (command, phase, current) => {
      if (options.beforeSend) await options.beforeSend(command, phase)
      if (!current()) return false
      sent.push([command.id, phase])
      return true
    }
  })
  cleanups.push(() => runner.stopAll(false))
  return {
    runner,
    main,
    query,
    sent,
    errors,
    setCommands: (value: SavedCommand[]) => {
      commands = value
      runner.sync(value)
    }
  }
}

test('hold sends main once, repeats the referenced packet at the configured interval, and releases once', async () => {
  const f = fixture()
  f.runner.start(f.main)
  await flush()
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion']
  ])
  jest.advanceTimersByTime(199)
  await flush()
  assert.equal(f.sent.length, 2)
  jest.advanceTimersByTime(1)
  await flush()
  assert.deepEqual(f.sent.at(-1), [2, 'companion'])
  await f.runner.stop(1)
  await f.runner.stop(1)
  jest.advanceTimersByTime(2000)
  await flush()
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion'],
    [2, 'companion'],
    [1, 'release']
  ])
  // The referenced command's own automatic and attached settings do not recurse.
  assert.equal(f.runner.isActive(2), false)
})

test('non-looping attachment runs only once while held', async () => {
  const f = fixture({
    command: {
      companion: {
        enabled: true,
        source: 'command',
        template: '',
        commandId: 2,
        loop: false,
        interval: 1
      }
    }
  })
  f.runner.start(f.main)
  await flush()
  jest.advanceTimersByTime(5000)
  await flush()
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion']
  ])
})

test('release during main processing prevents both the pending main packet and attachment', async () => {
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  const f = fixture({ beforeSend: (_command, phase) => (phase === 'press' ? gate : undefined) })
  f.runner.start(f.main)
  await flush()
  const stopped = f.runner.stop(1)
  finish()
  await stopped
  await flush()
  jest.advanceTimersByTime(1000)
  await flush()
  assert.deepEqual(f.sent, [[1, 'release']])
})

test('release cancels an attachment still being processed', async () => {
  let finish!: () => void
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  const f = fixture({
    beforeSend: (_command, phase) => (phase === 'companion' ? gate : undefined)
  })
  f.runner.start(f.main)
  await flush()
  await f.runner.stop(1)
  finish()
  await flush()
  jest.advanceTimersByTime(1000)
  await flush()
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [1, 'release']
  ])
})

test('automatic count completion cancels attachment timers and emits release', async () => {
  const f = fixture({ command: { autoSend: true, autoSendCount: 2 } })
  f.runner.start(f.main)
  await flush()
  jest.advanceTimersByTime(100)
  await flush()
  assert.equal(f.runner.isActive(1), false)
  jest.advanceTimersByTime(1000)
  await flush()
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion'],
    [1, 'press'],
    [1, 'release']
  ])
})

test('disconnect cancels timers without release and does not resume implicitly', async () => {
  const f = fixture()
  f.runner.start(f.main)
  await flush()
  f.runner.stopAll(false)
  jest.advanceTimersByTime(1000)
  await flush()
  assert.equal(f.runner.isActive(1), false)
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion']
  ])
})

test('missing references reject before sending the main packet; deletion stops an active owner', async () => {
  const f = fixture()
  f.runner.start(f.main)
  await flush()
  f.setCommands([f.main])
  await flush()
  assert.equal(f.runner.isActive(1), false)
  assert.deepEqual(f.sent.at(-1), [1, 'release'])
  const count = f.sent.length
  f.runner.start(f.main)
  await flush()
  assert.equal(f.sent.length, count)
  assert.equal(f.errors.length, 1)
})

test('group execution attaches once and respects group cancellation', async () => {
  const f = fixture()
  assert.equal(await f.runner.sendOnce(f.main, () => true), true)
  jest.advanceTimersByTime(1000)
  await flush()
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion']
  ])
  assert.equal(await f.runner.sendOnce(f.main, () => false), false)
  assert.equal(f.sent.length, 2)
})

test('live parameters are updated without restarting, but packet definition changes stop the run', async () => {
  const f = fixture()
  f.runner.start(f.main)
  await flush()
  const next: SavedCommand = {
    ...f.main,
    parameters: [{ id: 'speed', value: '100', inputMode: 'ascii', byteLength: 1 }]
  }
  f.setCommands([next, f.query])
  await flush()
  assert.equal(f.runner.isActive(1), true)
  f.setCommands([{ ...next, template: 'RIGHT' }, f.query])
  await flush()
  assert.equal(f.runner.isActive(1), false)
  assert.deepEqual(f.sent.at(-1), [1, 'release'])
})

test('an attachment processing error stops the main session and sends its release packet', async () => {
  const f = fixture({
    beforeSend: (_command, phase) => {
      if (phase === 'companion') throw Error('invalid checksum')
    }
  })
  f.runner.start(f.main)
  await flush()
  assert.equal(f.runner.isActive(1), false)
  assert.equal(f.errors.length, 1)
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [1, 'release']
  ])
})

test('custom attachment inherits main settings and cancels on release', async () => {
  const packets: { command: SavedCommand; phase: CommandPhase }[] = []
  const f = fixture({
    command: {
      targetPort: 'COM4',
      processingMode: 'program',
      companion: {
        enabled: true,
        source: 'custom',
        commandId: 2,
        template: 'GET X',
        loop: true,
        interval: 50
      }
    },
    beforeSend: (command, phase) => packets.push({ command, phase })
  })
  f.runner.start(f.main)
  await flush()
  jest.advanceTimersByTime(50)
  await flush()
  await f.runner.stop(1)
  const attached = packets.filter((packet) => packet.phase === 'companion')
  assert.equal(attached.length, 2)
  assert.equal(attached[0].command.template, 'GET X')
  assert.equal(attached[0].command.id, 1, 'custom source excludes the also-configured reference')
  assert.equal(attached[0].command.targetPort, 'COM4')
  assert.equal(attached[0].command.processingMode, 'program')
  assert.equal(attached[0].command.companion, undefined)
  jest.advanceTimersByTime(1000)
  await flush()
  assert.equal(packets.length, 4)
})

test('closing the main port stops queries even while a different port remains open', async () => {
  const f = fixture({ command: { targetPort: 'COM1' } })
  f.runner.start(f.main)
  await flush()
  f.runner.syncPorts(['COM2'])
  jest.advanceTimersByTime(1000)
  await flush()
  assert.equal(f.runner.isActive(1), false)
  assert.deepEqual(f.sent, [
    [1, 'press'],
    [2, 'companion']
  ])
})

test('closing the query port releases the main command on its still-open port', async () => {
  const f = fixture({ command: { targetPort: 'COM1' } })
  f.runner.start(f.main)
  await flush()
  f.runner.syncPorts(['COM1'])
  await flush()
  assert.equal(f.runner.isActive(1), false)
  assert.deepEqual(f.sent.at(-1), [1, 'release'])
})
