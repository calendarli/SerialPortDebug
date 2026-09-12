interface WritableSerialPort {
  write(data: Buffer, callback: (error?: Error | null) => void): unknown
  drain(callback: (error?: Error | null) => void): unknown
}

export function writeSerialData(
  port: WritableSerialPort,
  data: Buffer,
  virtualPair: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(data, (error) => {
      if (error) return reject(error)
      // The UMDF pair completes writes after delivery to the peer buffer.
      // It does not support FlushFileBuffers; physical ports must still drain.
      if (virtualPair) return resolve()
      port.drain((drainError) => (drainError ? reject(drainError) : resolve()))
    })
  })
}
