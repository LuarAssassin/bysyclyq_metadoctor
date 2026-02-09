import { useCallback, useEffect, useRef, useState } from 'react'
import type { KnowledgeIndexItem, KnowledgeTagSummary } from '@/types/api'

/* ── 类型 ─────────────────────── */

interface TagNode {
  id: number
  name: string
  fileCount: number
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

interface TagEdge {
  a: number   // node index
  b: number   // node index
  weight: number
}

interface Props {
  tags: KnowledgeTagSummary[]
  indexes: KnowledgeIndexItem[]
  className?: string
}

/* ── 颜色 ─────────────────────── */

const BG_GRADIENT_DARK  = '#0c1929'
const BG_GRADIENT_LIGHT = '#0f2847'
const NODE_FILL_INNER   = 'rgba(56, 189, 248, 0.95)'  // ice-400
const NODE_FILL_OUTER   = 'rgba(14, 165, 233, 0.7)'   // ice-500
const NODE_GLOW          = 'rgba(56, 189, 248, 0.35)'
const NODE_HOVER_GLOW    = 'rgba(56, 189, 248, 0.7)'
const EDGE_COLOR         = 'rgba(56, 189, 248, 0.12)'
const EDGE_HOVER_COLOR   = 'rgba(56, 189, 248, 0.45)'
const LABEL_COLOR        = 'rgba(226, 232, 240, 0.85)'
const LABEL_HOVER_COLOR  = '#f0f9ff'
const COUNT_COLOR        = 'rgba(148, 163, 184, 0.7)'

/* ── 力学常数 ─────────────────── */

const REPULSION   = 2800
const GRAVITY     = 0.012
const SPRING_K    = 0.004
const SPRING_REST = 80
const DAMPING     = 0.88
const MAX_SPEED   = 4
const SETTLE_THRESHOLD = 0.08
const WARM_ITERS  = 120

/* ── 工具 ─────────────────────── */

function buildGraph(tags: KnowledgeTagSummary[], indexes: KnowledgeIndexItem[]) {
  if (!tags.length) return { nodes: [] as TagNode[], edges: [] as TagEdge[] }

  const maxCount = Math.max(...tags.map((t) => t.file_count), 1)

  // 构建节点
  const nodes: TagNode[] = tags.map((t) => ({
    id: t.id,
    name: t.name,
    fileCount: t.file_count,
    x: 0, y: 0, vx: 0, vy: 0,
    radius: 6 + (t.file_count / maxCount) * 18,
  }))

  // 随机初始位置（圆形分布）
  const n = nodes.length
  nodes.forEach((nd, i) => {
    const angle = (2 * Math.PI * i) / n + (Math.random() - 0.5) * 0.4
    const dist = 40 + Math.random() * 100
    nd.x = Math.cos(angle) * dist
    nd.y = Math.sin(angle) * dist
  })

  // 通过索引数据计算共现边
  const nameToIdx = new Map<string, number>()
  nodes.forEach((nd, i) => nameToIdx.set(nd.name, i))

  const edgeMap = new Map<string, number>()
  indexes.forEach((idx) => {
    const matched = idx.tags.map((t) => nameToIdx.get(t)).filter((v): v is number => v !== undefined)
    for (let i = 0; i < matched.length; i++) {
      for (let j = i + 1; j < matched.length; j++) {
        const key = `${Math.min(matched[i]!, matched[j]!)}-${Math.max(matched[i]!, matched[j]!)}`
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1)
      }
    }
  })

  const edges: TagEdge[] = []
  edgeMap.forEach((weight, key) => {
    const [a, b] = key.split('-').map(Number) as [number, number]
    edges.push({ a, b, weight })
  })

  return { nodes, edges }
}

function simulate(nodes: TagNode[], edges: TagEdge[], _iterations: number) {
  for (let iter = 0; iter < _iterations; iter++) {
    // 斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ni = nodes[i]!, nj = nodes[j]!
        let dx = ni.x - nj.x
        let dy = ni.y - nj.y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = 1 }
        const f = REPULSION / (dist * dist)
        const fx = (dx / dist) * f
        const fy = (dy / dist) * f
        ni.vx += fx; ni.vy += fy
        nj.vx -= fx; nj.vy -= fy
      }
    }

    // 弹簧引力（沿边）
    for (const e of edges) {
      const na = nodes[e.a]!, nb = nodes[e.b]!
      const dx = nb.x - na.x
      const dy = nb.y - na.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const stretch = dist - SPRING_REST
      const f = SPRING_K * stretch * (1 + e.weight * 0.3)
      const fx = (dx / dist) * f
      const fy = (dy / dist) * f
      na.vx += fx; na.vy += fy
      nb.vx -= fx; nb.vy -= fy
    }

    // 重力（指向中心）
    for (const nd of nodes) {
      nd.vx -= nd.x * GRAVITY
      nd.vy -= nd.y * GRAVITY
    }

    // 更新位置
    for (const nd of nodes) {
      nd.vx *= DAMPING
      nd.vy *= DAMPING
      const speed = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy)
      if (speed > MAX_SPEED) { nd.vx = (nd.vx / speed) * MAX_SPEED; nd.vy = (nd.vy / speed) * MAX_SPEED }
      nd.x += nd.vx
      nd.y += nd.vy
    }
  }
}

function isSettled(nodes: TagNode[]): boolean {
  let totalV = 0
  for (const nd of nodes) totalV += Math.abs(nd.vx) + Math.abs(nd.vy)
  return (totalV / Math.max(nodes.length, 1)) < SETTLE_THRESHOLD
}

/* ── 组件 ─────────────────────── */

export default function TagGraph({ tags, indexes, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<{ nodes: TagNode[]; edges: TagEdge[] }>({ nodes: [], edges: [] })
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)
  const animRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0 })

  // 构建图数据（tags / indexes 变化时重建）
  useEffect(() => {
    const g = buildGraph(tags, indexes)
    simulate(g.nodes, g.edges, WARM_ITERS)
    graphRef.current = g
    setSettled(false)
  }, [tags, indexes])

  // 绘制
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = sizeRef.current
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const { nodes, edges } = graphRef.current
    const cx = w / 2
    const cy = h / 2

    // 背景渐变
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7)
    bgGrad.addColorStop(0, BG_GRADIENT_LIGHT)
    bgGrad.addColorStop(1, BG_GRADIENT_DARK)
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, w, h)

    // 微粒点缀（固定种子伪随机）
    ctx.fillStyle = 'rgba(148, 203, 236, 0.08)'
    for (let i = 0; i < 60; i++) {
      const px = ((i * 137.508) % w)
      const py = ((i * 97.531 + 29) % h)
      ctx.beginPath()
      ctx.arc(px, py, 0.6 + (i % 3) * 0.4, 0, Math.PI * 2)
      ctx.fill()
    }

    if (!nodes.length) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)'
      ctx.font = '13px "Inter", "Noto Sans SC", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('暂无标签数据', cx, cy)
      return
    }

    // 计算 auto-fit 视口
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const nd of nodes) {
      if (nd.x - nd.radius < minX) minX = nd.x - nd.radius
      if (nd.x + nd.radius > maxX) maxX = nd.x + nd.radius
      if (nd.y - nd.radius < minY) minY = nd.y - nd.radius
      if (nd.y + nd.radius > maxY) maxY = nd.y + nd.radius
    }
    const pad = 50
    const rangeX = (maxX - minX) + pad * 2
    const rangeY = (maxY - minY) + pad * 2
    const scale = Math.min(w / rangeX, h / rangeY, 1.5)
    const offsetX = cx - ((minX + maxX) / 2) * scale
    const offsetY = cy - ((minY + maxY) / 2) * scale
    const tx = (x: number) => x * scale + offsetX
    const ty = (y: number) => y * scale + offsetY

    // 确定 hover 相关节点
    const hoverConnected = new Set<number>()
    if (hoverIdx !== null) {
      hoverConnected.add(hoverIdx)
      for (const e of edges) {
        if (e.a === hoverIdx) hoverConnected.add(e.b)
        if (e.b === hoverIdx) hoverConnected.add(e.a)
      }
    }

    // 绘制边
    for (const e of edges) {
      const na = nodes[e.a]!, nb = nodes[e.b]!
      const isHot = hoverIdx !== null && (e.a === hoverIdx || e.b === hoverIdx)
      ctx.beginPath()
      ctx.moveTo(tx(na.x), ty(na.y))
      ctx.lineTo(tx(nb.x), ty(nb.y))
      ctx.strokeStyle = isHot ? EDGE_HOVER_COLOR : EDGE_COLOR
      ctx.lineWidth = isHot ? 1.5 + e.weight * 0.4 : 0.6 + e.weight * 0.2
      ctx.stroke()
    }

    // 绘制节点
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i]!
      const px = tx(nd.x)
      const py = ty(nd.y)
      const r = nd.radius * scale
      const isHover = i === hoverIdx
      const isDim = hoverIdx !== null && !hoverConnected.has(i)

      // 光晕
      if (!isDim) {
        const glow = ctx.createRadialGradient(px, py, r * 0.3, px, py, r * (isHover ? 3.5 : 2.2))
        glow.addColorStop(0, isHover ? NODE_HOVER_GLOW : NODE_GLOW)
        glow.addColorStop(1, 'transparent')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(px, py, r * (isHover ? 3.5 : 2.2), 0, Math.PI * 2)
        ctx.fill()
      }

      // 节点主体
      const grad = ctx.createRadialGradient(px - r * 0.25, py - r * 0.25, r * 0.1, px, py, r)
      grad.addColorStop(0, isDim ? 'rgba(56, 189, 248, 0.25)' : NODE_FILL_INNER)
      grad.addColorStop(1, isDim ? 'rgba(14, 165, 233, 0.15)' : NODE_FILL_OUTER)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fill()

      // 边框
      if (isHover) {
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.8)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // 标签名
      const fontSize = Math.max(9, Math.min(12, 8 + r * 0.3))
      ctx.font = `500 ${fontSize}px "Inter", "Noto Sans SC", sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = isDim ? 'rgba(148, 163, 184, 0.3)' : isHover ? LABEL_HOVER_COLOR : LABEL_COLOR
      ctx.fillText(nd.name, px, py + r + fontSize + 2)

      // 文件数
      if (!isDim) {
        ctx.font = `400 ${Math.max(8, fontSize - 2)}px "Inter", sans-serif`
        ctx.fillStyle = isHover ? 'rgba(186, 230, 253, 0.8)' : COUNT_COLOR
        ctx.fillText(`${nd.fileCount} 文件`, px, py + r + fontSize + 2 + fontSize * 0.9)
      }
    }
  }, [hoverIdx])

  // 动画循环
  useEffect(() => {
    let running = true

    const tick = () => {
      if (!running) return
      const { nodes, edges } = graphRef.current
      if (nodes.length && !settled) {
        simulate(nodes, edges, 1)
        if (isSettled(nodes)) setSettled(true)
      }
      draw()
      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(animRef.current) }
  }, [draw, settled])

  // 尺寸响应
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      sizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height }
    })
    ro.observe(container)
    // 初始赋值
    sizeRef.current = { w: container.clientWidth, h: container.clientHeight }
    return () => ro.disconnect()
  }, [])

  // 鼠标交互
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const { nodes } = graphRef.current
    const { w, h } = sizeRef.current

    if (!nodes.length) { setHoverIdx(null); return }

    // 复用 auto-fit 参数
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const nd of nodes) {
      if (nd.x - nd.radius < minX) minX = nd.x - nd.radius
      if (nd.x + nd.radius > maxX) maxX = nd.x + nd.radius
      if (nd.y - nd.radius < minY) minY = nd.y - nd.radius
      if (nd.y + nd.radius > maxY) maxY = nd.y + nd.radius
    }
    const pad = 50
    const rangeX = (maxX - minX) + pad * 2
    const rangeY = (maxY - minY) + pad * 2
    const cx = w / 2
    const cy = h / 2
    const scale = Math.min(w / rangeX, h / rangeY, 1.5)
    const offsetX = cx - ((minX + maxX) / 2) * scale
    const offsetY = cy - ((minY + maxY) / 2) * scale

    let closest = -1
    let closestDist = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i]!
      const px = nd.x * scale + offsetX
      const py = nd.y * scale + offsetY
      const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2)
      const hitR = nd.radius * scale + 12
      if (dist < hitR && dist < closestDist) { closest = i; closestDist = dist }
    }
    setHoverIdx(closest >= 0 ? closest : null)
  }, [])

  const handleMouseLeave = useCallback(() => setHoverIdx(null), [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ minHeight: 280, position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="absolute inset-0 w-full h-full rounded-xl cursor-crosshair"
      />
      {/* 角落图例 */}
      <div className="absolute bottom-2.5 left-3 pointer-events-none flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-sky-400/80" /> 标签节点
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-6 h-px bg-sky-400/40" /> 共现关系
        </span>
        <span className="text-slate-500">节点越大 = 文件越多</span>
      </div>
    </div>
  )
}
