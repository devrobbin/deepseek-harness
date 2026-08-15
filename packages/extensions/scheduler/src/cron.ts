/**
 * Minimal standard 5-field cron expression parser and matcher.
 *
 * Supports: minute hour day-of-month month day-of-week
 * - '*' wildcard, '* / n' step, 'a-b' range, 'a,b' lists, fixed values
 * - day-of-week: 0-6 (0 = Sunday)
 * No seconds field, no names, no '?'/'L'/'W' — matches the common
 * 5-field subset needed for operation scheduling.
 */

export interface CronFields {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6],  // day-of-week
]

function parseField(expr: string, range: readonly [number, number]): number[] {
  const [min, max] = range
  const values = new Set<number>()
  for (const part of expr.split(',')) {
    const stepMatch = /^(\*|\d+-\d+)\/(\d+)$/.exec(part)
    if (stepMatch) {
      const rangePart = stepMatch[1]
      const stepStr = stepMatch[2]
      if (rangePart === undefined || stepStr === undefined) continue
      const step = Number(stepStr)
      if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step: ${part}`)
      let lo = min
      let hi = max
      if (rangePart !== '*') {
        const rangeSplit = rangePart.split('-')
        const a = Number(rangeSplit[0])
        const b = Number(rangeSplit[1])
        lo = a
        hi = b
      }
      for (let v = lo; v <= hi; v += step) values.add(v)
      continue
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch) {
      const a = Number(rangeMatch[1])
      const b = Number(rangeMatch[2])
      if (a > b) throw new Error(`invalid cron range: ${part}`)
      for (let v = a; v <= b; v++) values.add(v)
      continue
    }
    if (part === '*') {
      for (let v = min; v <= max; v++) values.add(v)
      continue
    }
    const fixed = Number(part)
    if (!Number.isInteger(fixed)) throw new Error(`invalid cron value: ${part}`)
    values.add(fixed)
  }
  for (const v of values) {
    if (v < min || v > max) throw new Error(`cron value out of range: ${v}`)
  }
  return [...values].sort((a, b) => a - b)
}

/** Parse a 5-field cron expression into per-field allowed values. */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${parts.length}: "${expr}"`)
  }
  const minute = parts[0]
  const hour = parts[1]
  const dayOfMonth = parts[2]
  const month = parts[3]
  const dayOfWeek = parts[4]
  if (
    minute === undefined || hour === undefined || dayOfMonth === undefined
    || month === undefined || dayOfWeek === undefined
  ) {
    throw new Error(`cron expression must have 5 fields: "${expr}"`)
  }
  return {
    minute: parseField(minute, FIELD_RANGES[0] as readonly [number, number]),
    hour: parseField(hour, FIELD_RANGES[1] as readonly [number, number]),
    dayOfMonth: parseField(dayOfMonth, FIELD_RANGES[2] as readonly [number, number]),
    month: parseField(month, FIELD_RANGES[3] as readonly [number, number]),
    dayOfWeek: parseField(dayOfWeek, FIELD_RANGES[4] as readonly [number, number]),
  }
}

/**
 * Whether the given date matches the parsed cron fields.
 * Day-of-month and day-of-week are OR'd (standard cron semantics: if both
 * are restricted, the job fires when either matches).
 */
export function cronMatches(fields: CronFields, date: Date): boolean {
  const minuteOk = fields.minute.includes(date.getMinutes())
  const hourOk = fields.hour.includes(date.getHours())
  const monthOk = fields.month.includes(date.getMonth() + 1)
  const domOk = fields.dayOfMonth.includes(date.getDate())
  const dowOk = fields.dayOfWeek.includes(date.getDay())
  const dayOk = fields.dayOfMonth.length === 31 || fields.dayOfWeek.length === 7
    ? domOk && dowOk
    : domOk || dowOk
  return minuteOk && hourOk && monthOk && dayOk
}

/** Next minute boundary after now (for the scan loop tick). */
export function nextScanTime(now: Date): Date {
  return new Date(now.getTime() + 60_000)
}
