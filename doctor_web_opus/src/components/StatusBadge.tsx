import { cn } from '@/lib/cn'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'ice' | 'neutral'

const styles: Record<Variant, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger:  'bg-red-50 text-red-700 border-red-200',
  info:    'bg-blue-50 text-blue-700 border-blue-200',
  ice:     'bg-ice-50 text-ice-700 border-ice-200',
  neutral: 'bg-alpine-50 text-alpine-600 border-alpine-200',
}

interface Props {
  variant?: Variant
  dot?: boolean
  children: React.ReactNode
  className?: string
}

export default function StatusBadge({ variant = 'neutral', dot, children, className }: Props) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border',
      styles[variant],
      className,
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-emerald-500': variant === 'success',
        'bg-amber-500': variant === 'warning',
        'bg-red-500': variant === 'danger',
        'bg-blue-500': variant === 'info',
        'bg-ice-500': variant === 'ice',
        'bg-alpine-400': variant === 'neutral',
      })} />}
      {children}
    </span>
  )
}
