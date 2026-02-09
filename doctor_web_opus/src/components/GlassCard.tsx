import { cn } from '@/lib/cn'
import { motion, type HTMLMotionProps } from 'framer-motion'
import type { ReactNode } from 'react'

interface Props extends Omit<HTMLMotionProps<'section'>, 'title'> {
  title?: ReactNode
  subtitle?: string
  extra?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  noPadding?: boolean
}

export default function GlassCard({
  title,
  subtitle,
  extra,
  children,
  className,
  bodyClassName,
  noPadding,
  ...motionProps
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn('glass overflow-hidden', className)}
      {...motionProps}
    >
      {(title || extra) && (
        <header className="flex items-center justify-between gap-3 border-b border-alpine-900/[0.06] px-5 py-3.5">
          <div className="min-w-0">
            {typeof title === 'string' ? (
              <h3 className="text-[15px] font-semibold text-alpine-900 truncate">{title}</h3>
            ) : title}
            {subtitle && (
              <p className="text-xs text-alpine-400 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          {extra && <div className="flex-shrink-0 flex items-center gap-2">{extra}</div>}
        </header>
      )}
      <div className={cn(!noPadding && 'p-5', bodyClassName)}>
        {children}
      </div>
    </motion.section>
  )
}
