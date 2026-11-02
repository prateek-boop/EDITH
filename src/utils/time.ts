export type TimestampInput = Date | string | number | null | undefined

export interface FormatTimestampOptions extends Intl.DateTimeFormatOptions {
  fallback?: string
}

/**
 * Formats a timestamp into a localized date-time string.
 *
 * @param value - The timestamp to format (Date, ISO string, epoch milliseconds, or null/undefined)
 * @param options - Intl.DateTimeFormatOptions with an optional fallback string
 * @returns Formatted timestamp string, or fallback if input is null/undefined/invalid
 */
export function formatTimestamp(
  value: TimestampInput,
  options?: FormatTimestampOptions
): string {
  const fallback = options?.fallback ?? 'N/A'
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }

  const { fallback: _unused, ...formatOptions } = options ?? {}

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...formatOptions,
  }

  return date.toLocaleString(undefined, defaultOptions)
}

/**
 * Formats a timestamp to display only the time component (HH:mm:ss).
 *
 * @param value - The timestamp to format
 * @param fallback - Fallback string if value is missing or invalid (default: 'Recent')
 * @returns Formatted time string
 */
export function formatTime(value?: TimestampInput, fallback = 'Recent'): string {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Formats a timestamp to display only the date component.
 *
 * @param value - The timestamp to format
 * @param fallback - Fallback string if value is missing or invalid (default: 'N/A')
 * @returns Formatted date string
 */
export function formatDate(value?: TimestampInput, fallback = 'N/A'): string {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }

  return date.toLocaleDateString()
}

/**
 * Formats a timestamp as relative time (e.g. 'just now', '5m ago', '2h ago', '3d ago').
 *
 * @param value - The timestamp to format
 * @param fallback - Fallback string if value is missing or invalid (default: 'N/A')
 * @returns Relative time string
 */
export function formatRelativeTime(value?: TimestampInput, fallback = 'N/A'): string {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  if (Number.isNaN(time)) {
    return fallback
  }

  const diffMs = Date.now() - time
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay}d ago`

  return date.toLocaleDateString()
}
