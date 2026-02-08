import request from '@/utils/request'
import type { VoiceAsset, VideoAsset, PaginatedData } from '@/types'

// Voice APIs
export const uploadVoice = (file: File, options?: { name?: string; preferred_name?: string; set_active?: boolean }): Promise<VoiceAsset> => {
  const formData = new FormData()
  formData.append('audio', file)
  if (options?.name) formData.append('name', options.name)
  if (options?.preferred_name) formData.append('preferred_name', options.preferred_name)
  if (options?.set_active !== undefined) formData.append('set_active', String(options.set_active))
  
  return request.post('/doctor/digital-human/voice/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const getVoices = (): Promise<VoiceAsset[]> => {
  return request.get('/doctor/digital-human/voice/')
}

// Video APIs
export const createVideos = (image: File, options?: {
  prompt?: string
  negative_prompt?: string
  duration?: number
  resolution?: '720P' | '1080P'
  generate_count?: number
}): Promise<{ count: number; failed_count: number; items: VideoAsset[]; failed_items: any[] }> => {
  const formData = new FormData()
  formData.append('image', image)
  if (options?.prompt) formData.append('prompt', options.prompt)
  if (options?.negative_prompt) formData.append('negative_prompt', options.negative_prompt)
  if (options?.duration) formData.append('duration', String(options.duration))
  if (options?.resolution) formData.append('resolution', options.resolution)
  if (options?.generate_count) formData.append('generate_count', String(options.generate_count))
  
  return request.post('/doctor/digital-human/videos/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const getVideos = (): Promise<VideoAsset[]> => {
  return request.get('/doctor/digital-human/videos/')
}

export const refreshVideo = (videoId: number): Promise<VideoAsset> => {
  return request.post(`/doctor/digital-human/videos/${videoId}/refresh/`)
}
