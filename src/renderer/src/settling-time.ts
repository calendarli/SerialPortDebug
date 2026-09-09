export function settlingTime(
  points: readonly { timestamp: number; value: number }[],
  stepIndex: number,
  target: number,
  tolerance: number
): number | null {
  if (stepIndex < 0 || stepIndex >= points.length) return null
  let lastOutside = points.length - 1
  while (lastOutside >= stepIndex && Math.abs(target - points[lastOutside].value) <= tolerance)
    lastOutside--
  const settledIndex = Math.max(stepIndex, lastOutside + 1)
  return settledIndex < points.length
    ? points[settledIndex].timestamp - points[stepIndex].timestamp
    : null
}
