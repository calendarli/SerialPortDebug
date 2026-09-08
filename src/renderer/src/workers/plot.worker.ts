/// <reference lib="webworker" />

type PlotSample = { id: number; values: Record<string, number> }
type InitMessage = { type: 'init'; canvas: OffscreenCanvas }
type DataMessage = {
  type: 'data'
  reset: boolean
  samples: PlotSample[]
  pointLimit: number
  pruneBeforeId: number
}
type RenderMessage = {
  type: 'render'
  width: number
  height: number
  dpr: number
  xWindowPoints: number
  endOffset: number
  yMin: number
  yMax: number
  channels: { name: string; color: string }[]
}
type Message = InitMessage | DataMessage | RenderMessage
type Point = { index: number; value: number }

const plotLeft = 28
const plotRight = 910
const plotTop = 20
const plotBottom = 365
const plotWidth = plotRight - plotLeft
const plotHeight = plotBottom - plotTop

let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null
let samples: PlotSample[] = []
let pendingRender: RenderMessage | null = null
let renderQueued = false

function downsampleMinMax(points: Point[], bucketCount: number): Point[] {
  if (points.length <= bucketCount * 2 || bucketCount < 2) return points
  const result: Point[] = []
  const size = points.length / bucketCount
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = Math.floor(bucket * size)
    const to = Math.min(points.length, Math.floor((bucket + 1) * size))
    if (from >= to) continue
    let minIndex = from
    let maxIndex = from
    for (let index = from + 1; index < to; index += 1) {
      if (points[index].value < points[minIndex].value) minIndex = index
      if (points[index].value > points[maxIndex].value) maxIndex = index
    }
    if (minIndex <= maxIndex) {
      result.push(points[minIndex])
      if (maxIndex !== minIndex) result.push(points[maxIndex])
    } else result.push(points[maxIndex], points[minIndex])
  }
  return result
}

function draw(message: RenderMessage): void {
  if (!canvas || !context) return
  const width = Math.max(1, Math.round(message.width * message.dpr))
  const height = Math.max(1, Math.round(message.height * message.dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  context.setTransform(
    message.dpr * (message.width / 1000),
    0,
    0,
    message.dpr * (message.height / 420),
    0,
    0
  )
  context.clearRect(0, 0, 1000, 420)
  const liveEndIndex = Math.max(0, samples.length - 1)
  const endIndex = Math.max(0, Math.min(liveEndIndex, liveEndIndex + message.endOffset))
  const viewStartIndex = endIndex - message.xWindowPoints + 1
  const firstIndex = Math.max(0, viewStartIndex - 1)
  const lastIndex = Math.min(samples.length, endIndex + 2)
  const ySpan = Math.max(Number.EPSILON, message.yMax - message.yMin)
  context.save()
  context.beginPath()
  context.rect(plotLeft, plotTop, plotWidth, plotHeight)
  context.clip()
  context.lineWidth = 2.5 * (1000 / Math.max(message.width, 1))
  context.lineJoin = 'round'
  context.lineCap = 'round'
  for (const channel of message.channels) {
    const raw: Point[] = []
    for (let index = firstIndex; index < lastIndex; index += 1) {
      const value = samples[index]?.values[channel.name]
      if (Number.isFinite(value)) raw.push({ index, value })
    }
    const points = downsampleMinMax(raw, Math.max(100, Math.floor(message.width)))
    if (!points.length) continue
    context.beginPath()
    let drawing = false
    let previousY = 0
    for (const point of points) {
      const x =
        plotLeft +
        ((point.index - viewStartIndex) / Math.max(1, message.xWindowPoints - 1)) * plotWidth
      const y = plotBottom - ((point.value - message.yMin) / ySpan) * plotHeight
      if (!drawing) context.moveTo(x, y)
      else {
        context.lineTo(x, previousY)
        context.lineTo(x, y)
      }
      previousY = y
      drawing = true
    }
    context.strokeStyle = channel.color
    context.stroke()
  }
  context.restore()
}

function queueRender(message: RenderMessage): void {
  pendingRender = message
  if (renderQueued) return
  renderQueued = true
  self.requestAnimationFrame(() => {
    renderQueued = false
    const next = pendingRender
    pendingRender = null
    if (next) draw(next)
  })
}

self.onmessage = (event: MessageEvent<Message>): void => {
  const message = event.data
  if (message.type === 'init') {
    canvas = message.canvas
    context = canvas.getContext('2d')
    return
  }
  if (message.type === 'data') {
    if (message.reset) samples = message.samples
    else if (message.samples.length) samples.push(...message.samples)
    if (message.pruneBeforeId) {
      let pruneCount = 0
      while (pruneCount < samples.length && samples[pruneCount].id < message.pruneBeforeId)
        pruneCount += 1
      if (pruneCount) samples = samples.slice(pruneCount)
    }
    if (samples.length > message.pointLimit) samples = samples.slice(-message.pointLimit)
    return
  }
  queueRender(message)
}

export {}
