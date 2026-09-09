import { appendCrc } from './serial-utils'

type Pending = {
  request: Uint8Array
  resolve: (frame: Uint8Array) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// One outstanding RTU transaction; transport chunks are never treated as frames.
export class ModbusClient {
  private bytes: number[] = []
  private pending?: Pending

  get busy(): boolean {
    return !!this.pending
  }

  async request(
    request: Uint8Array,
    send: () => Promise<boolean>,
    timeout = 3000
  ): Promise<Uint8Array> {
    if (this.pending) throw new Error('Modbus request already pending')
    this.bytes = []
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        request: request.slice(),
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pending !== pending) return
          this.cancel('Modbus response timeout')
        }, timeout)
      }
      this.pending = pending
      void Promise.resolve()
        .then(() => (this.pending === pending ? send() : false))
        .then(
          (success) => {
            if (!success && this.pending === pending) this.cancel('Modbus send failed')
          },
          (error: unknown) => {
            if (this.pending === pending)
              this.cancel(error instanceof Error ? error.message : String(error))
          }
        )
    })
  }

  push(chunk: Uint8Array): void {
    if (!this.pending) return
    for (const byte of chunk) this.bytes.push(byte)
    let consumed = 0
    while (this.pending && this.bytes.length - consumed >= 5) {
      const pending = this.pending
      const request = pending.request
      const fn = this.bytes[consumed + 1]
      if (
        this.bytes[consumed] !== request[0] ||
        (fn !== request[1] && fn !== (request[1] | 0x80))
      ) {
        consumed++
        continue
      }
      const exception = (fn & 0x80) !== 0
      const length = exception ? 5 : fn === 3 ? this.bytes[consumed + 2] + 5 : 8
      if (
        !exception &&
        fn === 3 &&
        this.bytes[consumed + 2] !== ((request[4] << 8) | request[5]) * 2
      ) {
        consumed++
        continue
      }
      if (this.bytes.length - consumed < length) break
      const frame = Uint8Array.from(this.bytes.slice(consumed, consumed + length))
      const expected = appendCrc(frame.subarray(0, -2), 'modbus')
      if (frame.at(-2) !== expected.at(-2) || frame.at(-1) !== expected.at(-1)) {
        consumed++
        continue
      }
      consumed += length
      if (
        !exception &&
        fn !== 3 &&
        !frame.subarray(2, 6).every((byte, index) => byte === request[index + 2])
      )
        continue
      clearTimeout(pending.timer)
      this.pending = undefined
      if (exception) pending.reject(new Error(`Modbus exception ${frame[2]}`))
      else pending.resolve(frame)
    }
    this.bytes = this.pending ? this.bytes.slice(consumed) : []
  }

  cancel(message = 'Modbus connection changed'): void {
    const pending = this.pending
    this.pending = undefined
    this.bytes = []
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
  }
}
