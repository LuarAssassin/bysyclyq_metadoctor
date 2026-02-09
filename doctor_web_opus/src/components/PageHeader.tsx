import { cn } from '@/lib/cn'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  children?: ReactNode
  className?: string
}

export default function PageHeader({ title, subtitle, children, className }: Props) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'glass-strong flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-alpine-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-alpine-400 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex-shrink-0 flex items-center gap-2">{children}</div>}
    </motion.header>
  )
}
