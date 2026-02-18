import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

function appVersionPlugin(): Plugin {
  let version = ''
  return {
    name: 'app-version',
    config() {
      try {
        const hash = execSync('git rev-parse --short HEAD').toString().trim()
        version = `${hash}-${Date.now()}`
      } catch {
        version = Date.now().toString()
      }
      return { define: { __APP_VERSION__: JSON.stringify(version) } }
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), appVersionPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['framer-motion', 'lucide-react', 'sonner'],
          'vendor-md': ['@uiw/react-md-editor', 'react-markdown', 'remark-gfm'],
        },
      },
    },
  },
})
