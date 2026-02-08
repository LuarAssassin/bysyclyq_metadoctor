import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

type ThemeMode = 'light' | 'dark' | 'auto'

export const useThemeStore = defineStore('theme', () => {
  // State
  const themeMode = ref<ThemeMode>((localStorage.getItem('theme_mode') as ThemeMode) || 'light')
  const systemDark = ref(false)

  // Getters
  const isDark = computed(() => {
    if (themeMode.value === 'auto') {
      return systemDark.value
    }
    return themeMode.value === 'dark'
  })

  const currentTheme = computed(() => isDark.value ? 'dark' : 'light')

  // Actions
  const setTheme = (mode: ThemeMode) => {
    themeMode.value = mode
    localStorage.setItem('theme_mode', mode)
    applyTheme()
  }

  const toggleTheme = () => {
    setTheme(isDark.value ? 'light' : 'dark')
  }

  const applyTheme = () => {
    const html = document.documentElement
    if (isDark.value) {
      html.classList.add('dark')
      html.setAttribute('data-theme', 'dark')
    } else {
      html.classList.remove('dark')
      html.setAttribute('data-theme', 'light')
    }
  }

  const initSystemListener = () => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mediaQuery.matches
    
    mediaQuery.addEventListener('change', (e) => {
      systemDark.value = e.matches
      if (themeMode.value === 'auto') {
        applyTheme()
      }
    })
  }

  const init = () => {
    initSystemListener()
    applyTheme()
  }

  // Watch for changes
  watch(isDark, applyTheme, { immediate: false })

  return {
    themeMode,
    isDark,
    currentTheme,
    setTheme,
    toggleTheme,
    init,
  }
})
