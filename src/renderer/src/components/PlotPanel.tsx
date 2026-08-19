import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InteractionEntry } from '../types'
import { FloatingPanel } from './FloatingPanel'

type Props = { entries: InteractionEntry[]; enabledPorts: string[]; embedded?: boolean }
type Sample = { id: number; timestamp: number; values: Record<string, number> }
type PlotColors = { background: string; grid: string; series: string[] }
type YRange = { min: number; max: number }
type HoverValue = { name: string; color: string; value: number; y: number }
type HoverState = { x: number; timestamp: number; values: HoverValue[] }
type SeriesPoint = { timestamp: number; value: number }
type PidSettings = {
  enabled: boolean
  channel: string
  target: number
  kp: number
  ki: number
  kd: number
  windowSeconds: number
  direction: 'direct' | 'reverse'
  deadband: number
  outputMin: number
  outputMax: number
  antiWindup: boolean
  integralLimit: number
  derivativeFilterHz: number
}

const defaultSeriesColors = [
  '#2563eb',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#64748b'
]
const defaultPlotColors: PlotColors = {
  background: '#ffffff',
  grid: '#e8edf4',
  series: defaultSeriesColors
}
const plotColorsKey = 'serialflow.plotColors'
const plotHeightKey = 'serialflow.plotPanelHeight'
const xWindowKey = 'serialflow.plotXWindowMs'
const disabledChannelsKey = 'serialflow.plotDisabledChannels'
const pidSettingsKey = 'serialflow.plotPidSettings'
const defaultPlotHeight = 260
const defaultXWindow = 10000
const plotLeft = 28
const plotRight = 910
const plotTop = 20
const plotBottom = 365
const plotWidth = plotRight - plotLeft
const plotHeight = plotBottom - plotTop

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function loadPlotColors(): PlotColors {
  try {
    const saved = JSON.parse(
      localStorage.getItem(plotColorsKey) || 'null'
    ) as Partial<PlotColors> | null
    return {
      background: isColor(saved?.background) ? saved.background : defaultPlotColors.background,
      grid: isColor(saved?.grid) ? saved.grid : defaultPlotColors.grid,
      series: defaultSeriesColors.map((color, index) =>
        isColor(saved?.series?.[index]) ? saved.series[index] : color
      )
    }
  } catch {
    return { ...defaultPlotColors, series: [...defaultSeriesColors] }
  }
}

function loadPlotHeight(): number {
  const saved = Number(localStorage.getItem(plotHeightKey))
  return Number.isFinite(saved) ? clamp(saved, 160, 520) : defaultPlotHeight
}

function loadXWindow(): number {
  const saved = Number(localStorage.getItem(xWindowKey))
  return Number.isFinite(saved) ? clamp(saved, 100, 60 * 60 * 1000) : defaultXWindow
}

function loadDisabledChannels(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(disabledChannelsKey) || '[]') as unknown
    return new Set(
      Array.isArray(saved)
        ? saved.filter((value): value is string => typeof value === 'string')
        : []
    )
  } catch {
    return new Set()
  }
}

function loadPidSettings(): PidSettings {
  const defaults: PidSettings = {
    enabled: false,
    channel: '',
    target: 0,
    kp: 1,
    ki: 0,
    kd: 0,
    windowSeconds: 5,
    direction: 'direct',
    deadband: 0,
    outputMin: -1000,
    outputMax: 1000,
    antiWindup: true,
    integralLimit: 1000,
    derivativeFilterHz: 10
  }
  try {
    const saved = JSON.parse(
      localStorage.getItem(pidSettingsKey) || 'null'
    ) as Partial<PidSettings> | null
    if (!saved) return defaults
    const outputMin = Number.isFinite(saved.outputMin)
      ? Number(saved.outputMin)
      : defaults.outputMin
    const outputMax = Number.isFinite(saved.outputMax)
      ? Number(saved.outputMax)
      : defaults.outputMax
    return {
      enabled: saved.enabled === true,
      channel: typeof saved.channel === 'string' ? saved.channel : '',
      target: Number.isFinite(saved.target) ? Number(saved.target) : defaults.target,
      kp: Math.max(0, Number(saved.kp) || 0),
      ki: Math.max(0, Number(saved.ki) || 0),
      kd: Math.max(0, Number(saved.kd) || 0),
      windowSeconds: clamp(Number(saved.windowSeconds) || defaults.windowSeconds, 1, 60),
      direction: saved.direction === 'reverse' ? 'reverse' : 'direct',
      deadband: Math.max(0, Number(saved.deadband) || 0),
      outputMin: Math.min(outputMin, outputMax),
      outputMax: Math.max(outputMin, outputMax),
      antiWindup: saved.antiWindup !== false,
      integralLimit: Math.max(0, Number(saved.integralLimit) || defaults.integralLimit),
      derivativeFilterHz: clamp(
        Number(saved.derivativeFilterHz) || defaults.derivativeFilterHz,
        0.01,
        1000
      )
    }
  } catch {
    return defaults
  }
}

function parseSample(entry: InteractionEntry, includePort: boolean): Sample | null {
  if (entry.direction !== 'rx') return null
  const text = (entry.plotText ?? entry.text).trim()
  const channelName = (name: string): string => (includePort ? `${entry.port} · ${name}` : name)
  const named = [...text.matchAll(/([\p{L}_][\p{L}\p{N}_]*)\s*[=:]\s*(-?\d+(?:\.\d+)?)/gu)]
  const timestamp = entry.timestampMs ?? entry.id
  if (named.length)
    return {
      id: entry.id,
      timestamp,
      values: Object.fromEntries(named.map((item) => [channelName(item[1]), Number(item[2])]))
    }
  const parts = text.split(/[,;\s]+/).filter(Boolean)
  if (!parts.length || parts.length > 8 || parts.some((part) => !Number.isFinite(Number(part))))
    return null
  return {
    id: entry.id,
    timestamp,
    values: Object.fromEntries(
      parts.map((value, index) => [channelName(`CH${index + 1}`), Number(value)])
    )
  }
}

function formatTime(timestamp: number, windowMs: number): string {
  const date = new Date(timestamp)
  const base = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
  return windowMs <= 60000 ? `${base}.${String(date.getMilliseconds()).padStart(3, '0')}` : base
}

function formatAxisValue(value: number): string {
  const absolute = Math.abs(value)
  if ((absolute > 0 && absolute < 0.001) || absolute >= 100000) return value.toExponential(2)
  return Number(value.toPrecision(5)).toLocaleString()
}

function downsampleMinMax(points: SeriesPoint[], bucketCount: number): SeriesPoint[] {
  if (points.length <= bucketCount * 2 || bucketCount < 2) return points
  const result: SeriesPoint[] = []
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
    } else {
      result.push(points[maxIndex], points[minIndex])
    }
  }
  return result
}

export function PlotPanel({ entries, enabledPorts, embedded = false }: Props): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const [frozenEntries, setFrozenEntries] = useState<InteractionEntry[]>([])
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('serialflow.plotCollapsed') === 'true'
  )
  const [height, setHeight] = useState(loadPlotHeight)
  const [plotColors, setPlotColors] = useState(loadPlotColors)
  const [resizing, setResizing] = useState(false)
  const [pointLimit, setPointLimit] = useState(() =>
    Math.max(100, Number(localStorage.getItem('serialflow.plotPointLimit')) || 1000)
  )
  const [startId, setStartId] = useState(0)
  const [xWindowMs, setXWindowMs] = useState(loadXWindow)
  const [viewEndTime, setViewEndTime] = useState<number | null>(null)
  const [manualYRange, setManualYRange] = useState<YRange | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [disabledChannels, setDisabledChannels] = useState(loadDisabledChannels)
  const [pidSettings, setPidSettings] = useState(loadPidSettings)
  const [canvasWidth, setCanvasWidth] = useState(1000)
  const [openPanel, setOpenPanel] = useState<'colors' | 'pid' | null>(null)
  const resizeStart = useRef({ y: 0, height: defaultPlotHeight, max: 520 })
  const plotCanvasRef = useRef<HTMLDivElement | null>(null)
  const curveCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastDrawEndRef = useRef(0)
  const lastDrawRangeRef = useRef<YRange | null>(null)
  const sampleCacheRef = useRef<{
    key: string
    lastEntryId: number
    samples: Sample[]
  }>({ key: '', lastEntryId: 0, samples: [] })
  const hoverFrameRef = useRef(0)
  const colorButtonRef = useRef<HTMLButtonElement | null>(null)
  const pidButtonRef = useRef<HTMLButtonElement | null>(null)
  const latestHeight = useRef(height)
  const xDrag = useRef<{ x: number; end: number } | null>(null)
  const yDrag = useRef<{ y: number; range: YRange } | null>(null)
  const closeFloatingPanel = useCallback(() => setOpenPanel(null), [])

  useEffect(() => {
    const canvas = plotCanvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) =>
      setCanvasWidth(Math.max(1, entry.contentRect.width))
    )
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [collapsed])

  const enabledPortSet = useMemo(() => new Set(enabledPorts), [enabledPorts])
  const allSamples = useMemo(() => {
    const source = paused ? frozenEntries : entries
    const key = `${paused ? 'paused' : 'live'}\u0000${startId}\u0000${pointLimit}\u0000${enabledPorts.join('\u0000')}`
    const cache = sampleCacheRef.current
    const latestEntryId = source.at(-1)?.id || 0
    const reset = cache.key !== key || latestEntryId < cache.lastEntryId
    const lastEntryId = reset ? 0 : cache.lastEntryId
    const additions = source
      .filter(
        (entry) =>
          entry.id > Math.max(startId, lastEntryId) && enabledPortSet.has(entry.port)
      )
      .map((entry) => parseSample(entry, enabledPorts.length > 1))
      .filter((item): item is Sample => Boolean(item))
    const oldestEntryId = source[0]?.id || 0
    const retained = reset
      ? []
      : cache.samples.filter((sample) => sample.id >= oldestEntryId && sample.id > startId)
    const samples = [...retained, ...additions].slice(-pointLimit)
    sampleCacheRef.current = { key, lastEntryId: latestEntryId, samples }
    return samples
  }, [enabledPortSet, enabledPorts, entries, frozenEntries, paused, pointLimit, startId])
  const liveEndTime = allSamples.at(-1)?.timestamp ?? 0
  const endTime = viewEndTime ?? liveEndTime
  const startTime = endTime - xWindowMs
  const visibleSamples = useMemo(
    () =>
      allSamples.filter((sample) => sample.timestamp >= startTime && sample.timestamp <= endTime),
    [allSamples, endTime, startTime]
  )
  const channelNames = useMemo(
    () => [...new Set(allSamples.flatMap((item) => Object.keys(item.values)))].slice(0, 8),
    [allSamples]
  )
  const activeChannelNames = useMemo(
    () => channelNames.filter((name) => !disabledChannels.has(name)),
    [channelNames, disabledChannels]
  )
  const autoYRange = useMemo<YRange>(() => {
    const values = visibleSamples.flatMap((sample) =>
      activeChannelNames.flatMap((name) =>
        Number.isFinite(sample.values[name]) ? [sample.values[name]] : []
      )
    )
    if (!values.length) return { min: -1, max: 1 }
    let min: number
    let max: number
    if (values.length >= 40) {
      const sorted = [...values].sort((left, right) => left - right)
      const trimCount = Math.max(1, Math.floor(sorted.length * 0.01))
      min = sorted[trimCount]
      max = sorted[sorted.length - 1 - trimCount]
    } else {
      min = Math.min(...values)
      max = Math.max(...values)
    }
    const padding = (max - min || Math.max(Math.abs(max), 1)) * 0.1
    return { min: min - padding, max: max + padding }
  }, [activeChannelNames, visibleSamples])
  const yRange = manualYRange ?? autoYRange
  const ySpan = Math.max(Number.EPSILON, yRange.max - yRange.min)
  const valueToY = useCallback(
    (value: number): number => plotBottom - ((value - yRange.min) / ySpan) * plotHeight,
    [yRange.min, ySpan]
  )
  const timeToX = useCallback(
    (timestamp: number): number => plotLeft + ((timestamp - startTime) / xWindowMs) * plotWidth,
    [startTime, xWindowMs]
  )
  const series = useMemo(
    () =>
      activeChannelNames.map((name) => {
        const colorIndex = channelNames.indexOf(name)
        const points = visibleSamples.flatMap((sample) =>
          Number.isFinite(sample.values[name])
            ? [{ timestamp: sample.timestamp, value: sample.values[name] }]
            : []
        )
        const values = points.map((point) => point.value)
        return {
          name,
          colorIndex,
          color: plotColors.series[colorIndex],
          min: values.length ? Math.min(...values) : 0,
          max: values.length ? Math.max(...values) : 0,
          latest: values.at(-1) ?? 0,
          points,
          renderPoints: downsampleMinMax(points, Math.max(100, Math.floor(canvasWidth)))
        }
      }),
    [activeChannelNames, canvasWidth, channelNames, plotColors.series, visibleSamples]
  )

  useEffect(() => {
    const canvas = curveCanvasRef.current
    const host = plotCanvasRef.current
    if (!canvas || !host || collapsed || !series.length) return
    const rect = host.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    const context = canvas.getContext('2d')
    if (!context) return
    const previousEnd = lastDrawEndRef.current || endTime
    const previousRange = lastDrawRangeRef.current || yRange
    const duration = viewEndTime === null ? Math.min(160, Math.max(50, endTime - previousEnd)) : 0
    const animationStart = performance.now()
    let frame = 0
    const draw = (now: number): void => {
      const progress = duration ? Math.min(1, (now - animationStart) / duration) : 1
      const eased = 1 - (1 - progress) ** 3
      const drawEnd = previousEnd + (endTime - previousEnd) * eased
      const drawRange = manualYRange
        ? manualYRange
        : {
            min: previousRange.min + (yRange.min - previousRange.min) * eased,
            max: previousRange.max + (yRange.max - previousRange.max) * eased
          }
      const drawSpan = Math.max(Number.EPSILON, drawRange.max - drawRange.min)
      context.setTransform(dpr * (rect.width / 1000), 0, 0, dpr * (rect.height / 420), 0, 0)
      context.clearRect(0, 0, 1000, 420)
      context.save()
      context.beginPath()
      context.rect(plotLeft, plotTop, plotWidth, plotHeight)
      context.clip()
      context.lineWidth = 2.5 * (1000 / Math.max(rect.width, 1))
      context.lineJoin = 'round'
      context.lineCap = 'round'
      for (const item of series) {
        if (!item.renderPoints.length) continue
        context.beginPath()
        let drawing = false
        item.renderPoints.forEach((point) => {
          const x = plotLeft + ((point.timestamp - (drawEnd - xWindowMs)) / xWindowMs) * plotWidth
          const y = plotBottom - ((point.value - drawRange.min) / drawSpan) * plotHeight
          if (y < plotTop || y > plotBottom) {
            drawing = false
            return
          }
          if (!drawing) context.moveTo(x, y)
          else context.lineTo(x, y)
          drawing = true
        })
        context.strokeStyle = item.color
        context.stroke()
      }
      context.restore()
      lastDrawEndRef.current = drawEnd
      lastDrawRangeRef.current = drawRange
      if (progress < 1) frame = window.requestAnimationFrame(draw)
    }
    frame = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(frame)
  }, [collapsed, endTime, manualYRange, series, viewEndTime, xWindowMs, yRange])
  const xTickCount = clamp(Math.floor(canvasWidth / 135) + 1, 6, 16)
  const xTicks = useMemo(
    () =>
      Array.from({ length: xTickCount }, (_, index) => {
        const ratio = index / (xTickCount - 1)
        return {
          x: plotLeft + ratio * plotWidth,
          timestamp: startTime + ratio * xWindowMs
        }
      }),
    [startTime, xTickCount, xWindowMs]
  )
  const yTicks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const ratio = index / 5
        return {
          y: plotBottom - ratio * plotHeight,
          value: yRange.min + ratio * ySpan
        }
      }),
    [yRange.min, ySpan]
  )
  const pidChannel = channelNames.includes(pidSettings.channel)
    ? pidSettings.channel
    : channelNames[0] || ''
  const pidAnalysis = useMemo(() => {
    if (!pidSettings.enabled || !pidChannel || !allSamples.length) return null
    const latest = allSamples.at(-1)?.timestamp || 0
    const cutoff = latest - pidSettings.windowSeconds * 1000
    const points = allSamples.flatMap((sample) =>
      sample.timestamp >= cutoff && Number.isFinite(sample.values[pidChannel])
        ? [{ timestamp: sample.timestamp, value: sample.values[pidChannel] }]
        : []
    )
    const current = points.at(-1)?.value
    if (current === undefined)
      return { ready: false as const, sampleCount: 0, message: '等待所选通道的实时数据' }
    if (points.length < 5)
      return {
        ready: false as const,
        sampleCount: points.length,
        current,
        message: `样本不足：至少需要 5 个，当前 ${points.length} 个`
      }
    const initial = points[0].value
    const target = pidSettings.target
    const initialError = target - initial
    const currentError = target - current
    const responseSpan = Math.max(Math.abs(initialError), Math.abs(target) * 0.01, 0.000001)
    const tolerance = Math.max(
      pidSettings.deadband,
      responseSpan * 0.03,
      Math.abs(target) * 0.005,
      0.000001
    )
    const errors = points.map((point) => target - point.value)
    const intervals = points
      .slice(1)
      .map((point, index) => point.timestamp - points[index].timestamp)
      .filter((interval) => interval > 0)
    const sortedIntervals = [...intervals].sort((left, right) => left - right)
    const samplePeriodMs = sortedIntervals.length
      ? sortedIntervals[Math.floor(sortedIntervals.length / 2)]
      : 10
    const meanInterval = intervals.length
      ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
      : samplePeriodMs
    const intervalDeviation = intervals.length
      ? Math.sqrt(
          intervals.reduce((sum, value) => sum + (value - meanInterval) ** 2, 0) / intervals.length
        )
      : 0
    const sampleJitter = meanInterval > 0 ? intervalDeviation / meanInterval : 0

    let integral = 0
    let filteredDerivative = 0
    let previousError = 0
    let previousTimestamp = points[0].timestamp
    let antiWindupActive = false
    let pTerm = 0
    let iTerm = 0
    let dTerm = 0
    let controlOutput = 0
    const outputMin = Math.min(pidSettings.outputMin, pidSettings.outputMax)
    const outputMax = Math.max(pidSettings.outputMin, pidSettings.outputMax)
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]
      const rawError = target - point.value
      const directedError = (pidSettings.direction === 'direct' ? 1 : -1) * rawError
      const error = Math.abs(rawError) <= pidSettings.deadband ? 0 : directedError
      const timestampDt = index ? (point.timestamp - previousTimestamp) / 1000 : 0
      const measuredDt = timestampDt > 0 ? timestampDt : samplePeriodMs / 1000
      const dt = clamp(measuredDt, 0.000001, Math.max(0.001, (samplePeriodMs / 1000) * 5))
      const rawDerivative = index ? (error - previousError) / dt : 0
      const filterAlpha = Math.exp(-2 * Math.PI * pidSettings.derivativeFilterHz * dt)
      filteredDerivative = filterAlpha * filteredDerivative + (1 - filterAlpha) * rawDerivative
      const previousIntegral = integral
      integral = clamp(integral + error * dt, -pidSettings.integralLimit, pidSettings.integralLimit)
      pTerm = pidSettings.kp * error
      iTerm = pidSettings.ki * integral
      dTerm = pidSettings.kd * filteredDerivative
      const unsaturated = pTerm + iTerm + dTerm
      controlOutput = clamp(unsaturated, outputMin, outputMax)
      const drivesFurtherIntoSaturation =
        (unsaturated > outputMax && error > 0) || (unsaturated < outputMin && error < 0)
      if (pidSettings.antiWindup && drivesFurtherIntoSaturation) {
        integral = previousIntegral
        iTerm = pidSettings.ki * integral
        controlOutput = clamp(pTerm + iTerm + dTerm, outputMin, outputMax)
        antiWindupActive = true
      }
      previousError = error
      previousTimestamp = point.timestamp
    }

    let crossings = 0
    for (let index = 1; index < errors.length; index += 1) {
      if (
        Math.abs(errors[index - 1]) > tolerance &&
        Math.abs(errors[index]) > tolerance &&
        Math.sign(errors[index - 1]) !== Math.sign(errors[index])
      )
        crossings += 1
    }
    const direction = Math.sign(initialError) || 1
    const overshoot = points.reduce(
      (maximum, point) => Math.max(maximum, (point.value - target) * direction),
      0
    )
    const overshootRatio = overshoot / responseSpan
    const tail = errors.slice(-Math.max(3, Math.ceil(errors.length * 0.25)))
    const tailMeanError = tail.reduce((sum, value) => sum + value, 0) / tail.length
    const progress = 1 - Math.abs(currentError) / responseSpan

    const baselineCount = Math.max(3, Math.min(10, Math.floor(points.length * 0.12)))
    const baselinePoints = points.slice(0, baselineCount)
    const baseline =
      baselinePoints.reduce((sum, point) => sum + point.value, 0) / baselinePoints.length
    const baselineNoise = Math.sqrt(
      baselinePoints.reduce((sum, point) => sum + (point.value - baseline) ** 2, 0) /
        baselinePoints.length
    )
    const stepAmplitude = target - baseline
    const stepThreshold = Math.max(baselineNoise * 3, Math.abs(stepAmplitude) * 0.02, tolerance)
    const stepIndex = points.findIndex(
      (point, index) => index >= baselineCount && Math.abs(point.value - baseline) >= stepThreshold
    )
    const normalizedResponse = (value: number): number =>
      Math.abs(stepAmplitude) > 0.000001 ? (value - baseline) / stepAmplitude : 0
    const findResponseTime = (level: number): number | null => {
      if (stepIndex < 0) return null
      const point = points
        .slice(stepIndex)
        .find((candidate) => normalizedResponse(candidate.value) >= level)
      return point ? point.timestamp : null
    }
    const time10 = findResponseTime(0.1)
    const time90 = findResponseTime(0.9)
    const riseTimeMs = time10 !== null && time90 !== null ? Math.max(0, time90 - time10) : null
    let settlingTimeMs: number | null = null
    if (stepIndex >= 0) {
      for (let index = stepIndex; index < points.length; index += 1) {
        if (points.slice(index).every((point) => Math.abs(target - point.value) <= tolerance)) {
          settlingTimeMs = points[index].timestamp - points[stepIndex].timestamp
          break
        }
      }
    }
    const durationMs = Math.max(1, points.at(-1)!.timestamp - points[0].timestamp)
    const noiseRatio = baselineNoise / Math.max(Math.abs(stepAmplitude), 0.000001)
    const sampleScore = clamp(points.length / 50, 0, 1)
    const durationScore = clamp(durationMs / (pidSettings.windowSeconds * 1000 * 0.8), 0, 1)
    const signalScore = clamp(1 - noiseRatio * 8, 0, 1)
    const regularityScore = clamp(1 - sampleJitter * 2, 0, 1)
    const responseScore = clamp(
      points.reduce((maximum, point) => Math.max(maximum, normalizedResponse(point.value)), 0),
      0,
      1
    )
    const identificationConfidence = Math.round(
      (sampleScore * 0.2 +
        durationScore * 0.15 +
        signalScore * 0.25 +
        regularityScore * 0.2 +
        responseScore * 0.2) *
        100
    )
    let pFactor = 0
    let iFactor = 0
    let dFactor = 0
    const reasons: string[] = []
    if (crossings >= 3) {
      pFactor -= 0.1
      iFactor -= 0.15
      dFactor += 0.1
      reasons.push(`检测到 ${crossings} 次过零振荡，建议降低 P/I、提高 D`)
    } else if (overshootRatio > 0.1) {
      pFactor -= 0.05
      iFactor -= 0.08
      dFactor += 0.08
      reasons.push(`超调约 ${(overshootRatio * 100).toFixed(1)}%，建议抑制超调`)
    }
    if (Math.abs(currentError) > tolerance && crossings < 3) {
      if (progress < 0.3) {
        pFactor += 0.08
        iFactor += 0.04
        reasons.push('误差收敛较慢，建议小幅提高 P/I')
      } else if (Math.abs(tailMeanError) > tolerance) {
        iFactor += 0.06
        reasons.push('存在持续稳态误差，建议小幅提高 I')
      }
    }
    if (!reasons.length) reasons.push('当前响应接近目标，建议保持参数并继续观察')
    if (sampleJitter > 0.1)
      reasons.push(`采样周期抖动 ${(sampleJitter * 100).toFixed(1)}%，计算已按实际 Δt 补偿`)
    if (identificationConfidence < 50)
      reasons.push('阶跃辨识可信度偏低，建议延长窗口或提高阶跃信噪比')
    const recommendation = (
      name: 'P' | 'I' | 'D',
      value: number,
      factor: number
    ): { name: 'P' | 'I' | 'D'; current: number; delta: number; next: number } => {
      const delta = (value > 0 ? value : 0.1) * clamp(factor, -0.5, 0.5)
      return { name, current: value, delta, next: Math.max(0, value + delta) }
    }
    return {
      ready: true as const,
      sampleCount: points.length,
      current,
      error: currentError,
      controlOutput,
      pTerm,
      iTerm,
      dTerm,
      antiWindupActive,
      samplePeriodMs,
      sampleJitter,
      riseTimeMs,
      settlingTimeMs,
      identificationConfidence,
      overshootRatio,
      crossings,
      reasons,
      recommendations: [
        recommendation('P', pidSettings.kp, pFactor),
        recommendation('I', pidSettings.ki, iFactor),
        recommendation('D', pidSettings.kd, dFactor)
      ]
    }
  }, [allSamples, pidChannel, pidSettings])

  const changePlotColors = (next: PlotColors): void => {
    setPlotColors(next)
    localStorage.setItem(plotColorsKey, JSON.stringify(next))
  }
  const changeSeriesColor = (index: number, color: string): void => {
    const seriesColors = [...plotColors.series]
    seriesColors[index] = color
    changePlotColors({ ...plotColors, series: seriesColors })
  }
  const toggleChannel = (name: string): void => {
    setDisabledChannels((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      localStorage.setItem(disabledChannelsKey, JSON.stringify([...next]))
      return next
    })
    setHover(null)
  }
  const updatePidSettings = (patch: Partial<PidSettings>): void => {
    const next = { ...pidSettings, ...patch }
    setPidSettings(next)
    localStorage.setItem(pidSettingsKey, JSON.stringify(next))
  }
  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const availableHeight = event.currentTarget.parentElement?.parentElement?.clientHeight || 700
    resizeStart.current = {
      y: event.clientY,
      height,
      max: Math.max(160, Math.min(520, availableHeight - 170))
    }
    latestHeight.current = height
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    const next = clamp(
      resizeStart.current.height + event.clientY - resizeStart.current.y,
      160,
      resizeStart.current.max
    )
    latestHeight.current = next
    setHeight(next)
  }
  const finishResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(plotHeightKey, String(latestHeight.current))
    setResizing(false)
  }
  const handleXWheel = (event: React.WheelEvent<SVGRectElement>): void => {
    event.preventDefault()
    const next = clamp(xWindowMs * (event.deltaY > 0 ? 1.25 : 0.8), 100, 60 * 60 * 1000)
    setXWindowMs(next)
    localStorage.setItem(xWindowKey, String(next))
  }
  const handleYWheel = (event: React.WheelEvent<SVGRectElement>): void => {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 1.2 : 0.8
    const center = (yRange.min + yRange.max) / 2
    const half = (ySpan * factor) / 2
    setManualYRange({ min: center - half, max: center + half })
  }
  const beginXDrag = (event: React.PointerEvent<SVGRectElement>): void => {
    event.preventDefault()
    xDrag.current = { x: event.clientX, end: endTime }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveXDrag = (event: React.PointerEvent<SVGRectElement>): void => {
    if (!xDrag.current) return
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect) return
    const deltaTime =
      ((event.clientX - xDrag.current.x) / rect.width) * (1000 / plotWidth) * xWindowMs
    const oldest = allSamples[0]?.timestamp ?? liveEndTime
    const minimumEnd = Math.min(liveEndTime, oldest + xWindowMs)
    const next = clamp(xDrag.current.end - deltaTime, minimumEnd, liveEndTime)
    setViewEndTime(next >= liveEndTime - 1 ? null : next)
  }
  const finishXDrag = (event: React.PointerEvent<SVGRectElement>): void => {
    if (!xDrag.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    xDrag.current = null
  }
  const beginYDrag = (event: React.PointerEvent<SVGRectElement>): void => {
    event.preventDefault()
    yDrag.current = { y: event.clientY, range: { ...yRange } }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveYDrag = (event: React.PointerEvent<SVGRectElement>): void => {
    if (!yDrag.current) return
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect) return
    const span = yDrag.current.range.max - yDrag.current.range.min
    const shift = -((event.clientY - yDrag.current.y) / rect.height) * (420 / plotHeight) * span
    setManualYRange({
      min: yDrag.current.range.min + shift,
      max: yDrag.current.range.max + shift
    })
  }
  const finishYDrag = (event: React.PointerEvent<SVGRectElement>): void => {
    if (!yDrag.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    yDrag.current = null
  }
  const handlePlotHover = (event: React.PointerEvent<SVGRectElement>): void => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect || !series.length || !visibleSamples.length) return setHover(null)
    const clientX = event.clientX
    window.cancelAnimationFrame(hoverFrameRef.current)
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      const pointerX = clamp(((clientX - rect.left) / rect.width) * 1000, plotLeft, plotRight)
      const pointerTime = startTime + ((pointerX - plotLeft) / plotWidth) * xWindowMs
      const nearestSample = visibleSamples.reduce((best, sample) =>
        Math.abs(sample.timestamp - pointerTime) < Math.abs(best.timestamp - pointerTime)
          ? sample
          : best
      )
      const timestamp = nearestSample.timestamp
      const x = timeToX(timestamp)
      const values = series.flatMap<HoverValue>((item) => {
        if (!item.points.length) return []
        const nearest = item.points.reduce((best, point) =>
          Math.abs(point.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
            ? point
            : best
        )
        return [
          { name: item.name, color: item.color, value: nearest.value, y: valueToY(nearest.value) }
        ]
      })
      setHover({ x, timestamp, values })
    })
  }
  const clearPlotHover = (): void => {
    window.cancelAnimationFrame(hoverFrameRef.current)
    setHover(null)
  }

  return (
    <section
      className={`plot-panel ${embedded ? 'embedded' : ''} ${collapsed ? 'collapsed' : ''}`}
      style={embedded ? { height: collapsed ? 58 : height } : undefined}
    >
      <header className="plot-toolbar">
        <div>
          <strong>实时曲线</strong>
          <span>
            {allSamples.length.toLocaleString()} 个采样点 · {series.length} 个通道 ·{' '}
            {(xWindowMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 秒视窗 ·{' '}
            {viewEndTime === null ? '实时' : '历史'}
          </span>
        </div>
        <label>
          绘图点数
          <input
            type="number"
            min="100"
            max="20000"
            value={pointLimit}
            onChange={(event) => {
              const value = Math.min(20000, Math.max(100, Number(event.target.value) || 1000))
              setPointLimit(value)
              localStorage.setItem('serialflow.plotPointLimit', String(value))
            }}
          />
        </label>
        <button disabled={viewEndTime === null} onClick={() => setViewEndTime(null)}>
          回到实时
        </button>
        <button disabled={manualYRange === null} onClick={() => setManualYRange(null)}>
          Y 自动
        </button>
        <button
          onClick={() => {
            if (!paused) setFrozenEntries(entries)
            setPaused((value) => !value)
          }}
        >
          {paused ? '继续绘图' : '暂停绘图'}
        </button>
        <button onClick={() => setStartId(entries.at(-1)?.id || 0)}>清空曲线</button>
        <button
          ref={colorButtonRef}
          className={openPanel === 'colors' ? 'active' : ''}
          aria-expanded={openPanel === 'colors'}
          onClick={() => setOpenPanel((current) => (current === 'colors' ? null : 'colors'))}
        >
          配色
        </button>
        <FloatingPanel
          anchorRef={colorButtonRef}
          open={openPanel === 'colors'}
          onClose={closeFloatingPanel}
        >
          <div className="plot-color-popover">
            <strong>实时曲线配色</strong>
            <div className="plot-color-grid">
              <label>
                背景
                <input
                  type="color"
                  value={plotColors.background}
                  onChange={(event) =>
                    changePlotColors({ ...plotColors, background: event.target.value })
                  }
                />
              </label>
              <label>
                网格
                <input
                  type="color"
                  value={plotColors.grid}
                  onChange={(event) =>
                    changePlotColors({ ...plotColors, grid: event.target.value })
                  }
                />
              </label>
              {plotColors.series.map((color, index) => (
                <label key={index}>
                  曲线 {index + 1}
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => changeSeriesColor(index, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <button
              onClick={() =>
                changePlotColors({ ...defaultPlotColors, series: [...defaultSeriesColors] })
              }
            >
              恢复默认配色
            </button>
          </div>
        </FloatingPanel>
        <button
          ref={pidButtonRef}
          className={openPanel === 'pid' ? 'active' : ''}
          aria-expanded={openPanel === 'pid'}
          onClick={() => setOpenPanel((current) => (current === 'pid' ? null : 'pid'))}
        >
          PID 调参
        </button>
        <FloatingPanel
          anchorRef={pidButtonRef}
          open={openPanel === 'pid'}
          onClose={closeFloatingPanel}
        >
          <div className="plot-pid-popover">
            <div className="plot-pid-title">
              <strong>PID 实时调参建议</strong>
              <label>
                <input
                  type="checkbox"
                  checked={pidSettings.enabled}
                  onChange={(event) => updatePidSettings({ enabled: event.target.checked })}
                />
                启用
              </label>
            </div>
            <div className="plot-pid-grid">
              <label>
                反馈通道
                <select
                  disabled={!pidSettings.enabled || !channelNames.length}
                  value={pidChannel}
                  onChange={(event) => updatePidSettings({ channel: event.target.value })}
                >
                  {!channelNames.length && <option value="">暂无通道</option>}
                  {channelNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                目标值
                <input
                  type="number"
                  step="any"
                  disabled={!pidSettings.enabled}
                  value={pidSettings.target}
                  onChange={(event) => updatePidSettings({ target: Number(event.target.value) })}
                />
              </label>
              {(['kp', 'ki', 'kd'] as const).map((key) => (
                <label key={key}>
                  当前 {key.slice(1).toUpperCase()}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={!pidSettings.enabled}
                    value={pidSettings[key]}
                    onChange={(event) =>
                      updatePidSettings({ [key]: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </label>
              ))}
              <label>
                分析窗口
                <span className="plot-pid-window-input">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    disabled={!pidSettings.enabled}
                    value={pidSettings.windowSeconds}
                    onChange={(event) =>
                      updatePidSettings({
                        windowSeconds: clamp(Number(event.target.value) || 1, 1, 60)
                      })
                    }
                  />
                  秒
                </span>
              </label>
              <label>
                控制方向
                <select
                  disabled={!pidSettings.enabled}
                  value={pidSettings.direction}
                  onChange={(event) =>
                    updatePidSettings({
                      direction: event.target.value as PidSettings['direction']
                    })
                  }
                >
                  <option value="direct">正向（误差增大→输出增大）</option>
                  <option value="reverse">反向（误差增大→输出减小）</option>
                </select>
              </label>
              <label>
                误差死区
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={!pidSettings.enabled}
                  value={pidSettings.deadband}
                  onChange={(event) =>
                    updatePidSettings({ deadband: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </label>
              <label>
                输出下限
                <input
                  type="number"
                  step="any"
                  disabled={!pidSettings.enabled}
                  value={pidSettings.outputMin}
                  onChange={(event) => updatePidSettings({ outputMin: Number(event.target.value) })}
                />
              </label>
              <label>
                输出上限
                <input
                  type="number"
                  step="any"
                  disabled={!pidSettings.enabled}
                  value={pidSettings.outputMax}
                  onChange={(event) => updatePidSettings({ outputMax: Number(event.target.value) })}
                />
              </label>
              <label>
                积分限幅
                <input
                  type="number"
                  min="0"
                  step="any"
                  disabled={!pidSettings.enabled}
                  value={pidSettings.integralLimit}
                  onChange={(event) =>
                    updatePidSettings({
                      integralLimit: Math.max(0, Number(event.target.value) || 0)
                    })
                  }
                />
              </label>
              <label>
                D 低通截止频率
                <span className="plot-pid-window-input">
                  <input
                    type="number"
                    min="0.01"
                    max="1000"
                    step="any"
                    disabled={!pidSettings.enabled}
                    value={pidSettings.derivativeFilterHz}
                    onChange={(event) =>
                      updatePidSettings({
                        derivativeFilterHz: clamp(Number(event.target.value) || 0.01, 0.01, 1000)
                      })
                    }
                  />
                  Hz
                </span>
              </label>
              <label className="plot-pid-check-option">
                <input
                  type="checkbox"
                  disabled={!pidSettings.enabled}
                  checked={pidSettings.antiWindup}
                  onChange={(event) => updatePidSettings({ antiWindup: event.target.checked })}
                />
                输出饱和时停止同向积分
              </label>
            </div>
            {!pidSettings.enabled ? (
              <div className="plot-pid-empty">
                启用后将计算控制增量、辨识阶跃响应并给出 P/I/D 增减建议
              </div>
            ) : !pidAnalysis?.ready ? (
              <div className="plot-pid-empty">{pidAnalysis?.message || '等待实时数据'}</div>
            ) : (
              <div className="plot-pid-result">
                <div className="plot-pid-metrics">
                  <span>实时值 {formatAxisValue(pidAnalysis.current)}</span>
                  <span>误差 {formatAxisValue(pidAnalysis.error)}</span>
                  <span>样本 {pidAnalysis.sampleCount}</span>
                  <span>周期 {pidAnalysis.samplePeriodMs.toFixed(2)} ms</span>
                  <span>抖动 {(pidAnalysis.sampleJitter * 100).toFixed(1)}%</span>
                </div>
                <div className="plot-pid-control-output">
                  <div>
                    <small>建议控制增量</small>
                    <strong>{formatAxisValue(pidAnalysis.controlOutput)}</strong>
                  </div>
                  <span>P {formatAxisValue(pidAnalysis.pTerm)}</span>
                  <span>I {formatAxisValue(pidAnalysis.iTerm)}</span>
                  <span>D {formatAxisValue(pidAnalysis.dTerm)}</span>
                  {pidAnalysis.antiWindupActive && <b>抗饱和已介入</b>}
                </div>
                <div className="plot-pid-identification">
                  <strong>
                    阶跃辨识可信度
                    <b
                      className={
                        pidAnalysis.identificationConfidence >= 75
                          ? 'high'
                          : pidAnalysis.identificationConfidence >= 50
                            ? 'medium'
                            : 'low'
                      }
                    >
                      {pidAnalysis.identificationConfidence}%
                    </b>
                  </strong>
                  <span>
                    上升时间{' '}
                    {pidAnalysis.riseTimeMs === null
                      ? '未识别'
                      : `${pidAnalysis.riseTimeMs.toFixed(1)} ms`}
                  </span>
                  <span>
                    稳定时间{' '}
                    {pidAnalysis.settlingTimeMs === null
                      ? '未稳定'
                      : `${pidAnalysis.settlingTimeMs.toFixed(1)} ms`}
                  </span>
                  <span>超调 {(pidAnalysis.overshootRatio * 100).toFixed(1)}%</span>
                </div>
                <div className="plot-pid-recommendations">
                  {pidAnalysis.recommendations.map((item) => (
                    <div key={item.name}>
                      <strong>{item.name}</strong>
                      <span
                        className={item.delta > 0 ? 'increase' : item.delta < 0 ? 'decrease' : ''}
                      >
                        {item.delta > 0 ? '+' : ''}
                        {formatAxisValue(item.delta)}
                      </span>
                      <span>建议 {formatAxisValue(item.next)}</span>
                    </div>
                  ))}
                </div>
                {pidAnalysis.reasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
              </div>
            )}
            <small>
              使用真实采样 Δt
              进行积分和微分补偿。建议不会自动写入设备，请先确认方向和输出范围，并在低风险工况下逐项小幅验证。
            </small>
          </div>
        </FloatingPanel>
        {embedded && (
          <button
            title={collapsed ? '展开实时曲线' : '收起实时曲线'}
            onClick={() => {
              const next = !collapsed
              setCollapsed(next)
              localStorage.setItem('serialflow.plotCollapsed', String(next))
            }}
          >
            {collapsed ? '展开' : '收起'}
          </button>
        )}
      </header>
      {!collapsed && (
        <div className="plot-legend">
          {channelNames.map((name, colorIndex) => {
            const item = series.find((candidate) => candidate.name === name)
            const enabled = !disabledChannels.has(name)
            return (
              <div key={name} className={enabled ? '' : 'disabled'}>
                <input
                  className="plot-channel-enabled"
                  type="checkbox"
                  checked={enabled}
                  aria-label={`${enabled ? '停用' : '启用'} ${name}`}
                  title={`${enabled ? '停用' : '启用'} ${name}`}
                  onChange={() => toggleChannel(name)}
                />
                <input
                  className="plot-series-color"
                  type="color"
                  value={plotColors.series[colorIndex]}
                  disabled={!enabled}
                  aria-label={`${name} 曲线颜色`}
                  title={`调整 ${name} 曲线颜色`}
                  onChange={(event) => changeSeriesColor(colorIndex, event.target.value)}
                />
                <strong>{name}</strong>
                {item ? (
                  <>
                    <span>当前 {formatAxisValue(item.latest)}</span>
                    <span>最小 {formatAxisValue(item.min)}</span>
                    <span>最大 {formatAxisValue(item.max)}</span>
                  </>
                ) : (
                  <span>已停用</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!collapsed && (
        <div
          ref={plotCanvasRef}
          className="plot-canvas"
          style={{ background: plotColors.background }}
        >
          {series.length ? (
            <>
            <canvas ref={curveCanvasRef} className="plot-curve-canvas" aria-hidden="true" />
            <svg viewBox="0 0 1000 420" preserveAspectRatio="none" aria-label="实时数据曲线">
              {xTicks.map((tick) => (
                <g key={tick.timestamp}>
                  <line
                    x1={tick.x}
                    y1={plotTop}
                    x2={tick.x}
                    y2={plotBottom}
                    className="plot-grid-line"
                    style={{ stroke: plotColors.grid }}
                  />
                </g>
              ))}
              {yTicks.map((tick) => (
                <g key={tick.y}>
                  <line
                    x1={plotLeft}
                    y1={tick.y}
                    x2={plotRight}
                    y2={tick.y}
                    className="plot-grid-line"
                    style={{ stroke: plotColors.grid }}
                  />
                </g>
              ))}
              <line
                x1={plotLeft}
                y1={plotBottom}
                x2={plotRight}
                y2={plotBottom}
                className="plot-axis"
              />
              <line
                x1={plotRight}
                y1={plotTop}
                x2={plotRight}
                y2={plotBottom}
                className="plot-axis"
              />
              {hover && (
                <g className="plot-crosshair" pointerEvents="none">
                  <line x1={hover.x} y1={plotTop} x2={hover.x} y2={plotBottom} />
                </g>
              )}
              <rect
                x={plotLeft}
                y={plotTop}
                width={plotWidth}
                height={plotHeight}
                fill="transparent"
                className="plot-hover-area"
                onPointerMove={handlePlotHover}
                onPointerLeave={clearPlotHover}
              />
              <rect
                x={plotLeft}
                y={plotBottom - 10}
                width={plotWidth}
                height="50"
                fill="transparent"
                className="plot-x-axis-hit"
                onWheel={handleXWheel}
                onPointerDown={beginXDrag}
                onPointerMove={moveXDrag}
                onPointerUp={finishXDrag}
                onPointerCancel={finishXDrag}
              />
              <rect
                x={plotRight - 10}
                y={plotTop}
                width="90"
                height={plotHeight}
                fill="transparent"
                className="plot-y-axis-hit"
                onWheel={handleYWheel}
                onPointerDown={beginYDrag}
                onPointerMove={moveYDrag}
                onPointerUp={finishYDrag}
                onPointerCancel={finishYDrag}
              />
            </svg>
            </>
          ) : (
            <div className="plot-empty">
              <strong>{enabledPorts.length ? '等待数值数据…' : '尚未启用曲线端口'}</strong>
              <span>
                {enabledPorts.length
                  ? '支持 PWM=10, Speed=20 或 10,20,30 格式；曲线解析不会改变数据交互的显示格式。'
                  : '请在左侧“串口”配置中勾选“接收数据绘制曲线”。'}
              </span>
            </div>
          )}
          {series.length > 0 && (
            <div className="plot-axis-label-layer" aria-hidden="true">
              {xTicks.map((tick, index) => (
                <span
                  key={`x-${tick.timestamp}`}
                  className="plot-html-x-label"
                  style={{
                    left: `${(tick.x / 1000) * 100}%`,
                    transform:
                      index === 0
                        ? 'none'
                        : index === xTicks.length - 1
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)'
                  }}
                >
                  {formatTime(tick.timestamp, xWindowMs)}
                </span>
              ))}
              {yTicks.map((tick) => (
                <span
                  key={`y-${tick.y}`}
                  className="plot-html-y-label"
                  style={{
                    left: `${((plotRight + 15) / 1000) * 100}%`,
                    top: `${(tick.y / 420) * 100}%`
                  }}
                >
                  {formatAxisValue(tick.value)}
                </span>
              ))}
            </div>
          )}
          {hover && series.length > 0 && (
            <>
              <div className="plot-hover-markers" aria-hidden="true">
                {hover.values.map((item) => (
                  <i
                    key={item.name}
                    style={{
                      left: `${(hover.x / 1000) * 100}%`,
                      top: `${(item.y / 420) * 100}%`,
                      background: item.color
                    }}
                  />
                ))}
              </div>
              <div
                className="plot-html-tooltip"
                style={
                  hover.x > 690
                    ? { right: `${((1000 - hover.x) / 1000) * 100 + 1}%` }
                    : { left: `${(hover.x / 1000) * 100 + 1}%` }
                }
              >
                <strong>{formatTime(hover.timestamp, 0)}</strong>
                {hover.values.map((item) => (
                  <span key={item.name} style={{ color: item.color }}>
                    {item.name}: {formatAxisValue(item.value)}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {embedded && !collapsed && (
        <div
          className={`plot-panel-resizer ${resizing ? 'resizing' : ''}`}
          title="拖拽调整数据交互顶部位置，双击恢复默认高度"
          onPointerDown={beginResize}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onDoubleClick={() => {
            latestHeight.current = defaultPlotHeight
            setHeight(defaultPlotHeight)
            localStorage.setItem(plotHeightKey, String(defaultPlotHeight))
          }}
        >
          <i />
        </div>
      )}
    </section>
  )
}
