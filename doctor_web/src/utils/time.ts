import dayjs from 'dayjs'

export const formatDateTime = (value?: string | null): string => {
  if (!value) {
    return '-'
  }
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}

export const formatRelativeSafe = (value?: string | null): string => {
  if (!value) {
    return '-'
  }
  return dayjs(value).format('MM-DD HH:mm')
}

export const formatBytes = (size?: number | null): string => {
  if (size === null || size === undefined || Number.isNaN(size)) {
    return '-'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
