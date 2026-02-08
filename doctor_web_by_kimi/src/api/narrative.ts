import request from '@/utils/request'
import type { NarrativeKernel, Annotation, RedlineRules, KernelPayload } from '@/types'

export const getNarrativeKernel = (): Promise<NarrativeKernel> => {
  return request.get('/doctor/narrative-kernel/')
}

export const updateNarrativeKernel = (payload: { payload: KernelPayload; note?: string }): Promise<NarrativeKernel> => {
  return request.put('/doctor/narrative-kernel/', payload)
}

export const patchNarrativeKernel = (changes: { changes: Partial<KernelPayload>; note?: string }): Promise<NarrativeKernel> => {
  return request.patch('/doctor/narrative-kernel/', changes)
}

export const createAnnotation = (data: {
  source: string
  question: string
  answer: string
  comment: string
  negative_rules?: string[]
  delta?: Partial<KernelPayload>
}): Promise<Annotation> => {
  return request.post('/doctor/narrative-kernel/annotations/', data)
}

export const getAnnotations = (params?: { limit?: number }): Promise<Annotation[]> => {
  return request.get('/doctor/narrative-kernel/annotations/', { params })
}

export const getRedlineRules = (): Promise<RedlineRules> => {
  return request.get('/doctor/narrative-kernel/redlines/')
}

export const addRedlineRules = (data: { rules: string[]; comment?: string }): Promise<void> => {
  return request.post('/doctor/narrative-kernel/redlines/', data)
}

export const deleteRedlineRules = (data: { rules: string[] }): Promise<void> => {
  return request.delete('/doctor/narrative-kernel/redlines/', { data })
}
