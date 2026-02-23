import { useMemo } from 'react'

const FLAKE_COUNT = 36

export default function Snowfall() {
  const flakes = useMemo(() =>
    Array.from({ length: FLAKE_COUNT }, (_, i) => {
      const size = 3 + Math.random() * 5
      const left = Math.random() * 100
      const delay = Math.random() * 12
      const duration = 8 + Math.random() * 10
      const drift = -20 + Math.random() * 40
      const opacity = 0.3 + Math.random() * 0.5
      return (
        <div
          key={i}
          className="snowflake"
          style={{
            width: size,
            height: size,
            left: `${left}%`,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
            opacity,
            '--drift': `${drift}px`,
          } as React.CSSProperties}
        />
      )
    }), [])

  return <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">{flakes}</div>
}
