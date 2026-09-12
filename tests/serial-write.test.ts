import { expect, mock, test } from 'bun:test'
import { writeSerialData } from '../src/main/serial-write'

for (const virtual of [false, true]) {
  test(`write failures propagate without drain or resend (virtual=${virtual})`, async () => {
    const failure = new Error('device disconnected')
    const port = {
      write: mock((_data: Buffer, done: (error?: Error) => void) => done(failure)),
      drain: mock((done: (error?: Error) => void) => done())
    }
    await expect(writeSerialData(port, Buffer.from([0, 255]), virtual)).rejects.toBe(failure)
    expect(port.write).toHaveBeenCalledTimes(1)
    expect(port.drain).not.toHaveBeenCalled()
  })
}

test('virtual pair succeeds without unsupported FlushFileBuffers', async () => {
  const port = {
    write: mock((_data: Buffer, done: (error?: Error) => void) => done()),
    drain: mock((done: (error?: Error) => void) => done(new Error('unsupported')))
  }
  await writeSerialData(port, Buffer.from([0, 255]), true)
  expect(port.write).toHaveBeenCalledTimes(1)
  expect(port.drain).not.toHaveBeenCalled()
})

test('physical port still waits for drain and propagates its failure', async () => {
  let completeDrain: ((error?: Error) => void) | undefined
  const port = {
    write: mock((_data: Buffer, done: (error?: Error) => void) => done()),
    drain: mock((done: (error?: Error) => void) => {
      completeDrain = done
    })
  }
  let settled = false
  const task = writeSerialData(port, Buffer.from([1]), false)
  void task.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  await Promise.resolve()
  expect(settled).toBe(false)
  const failure = new Error('drain failed')
  completeDrain!(failure)
  await expect(task).rejects.toBe(failure)
  expect(port.write).toHaveBeenCalledTimes(1)
})
