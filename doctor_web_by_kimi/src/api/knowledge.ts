import request from '@/utils/request'
import type { KnowledgeFile, KnowledgeIndex, TagStat, PaginatedData } from '@/types'

export const uploadKnowledge = (files: File[]): Promise<{ extract_queued_count: number; extract_failed_count: number; items: KnowledgeFile[] }> => {
  const formData = new FormData()
  files.forEach(file => {
    formData.append('files', file)
  })
  
  return request.post('/doctor/knowledge/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export const getKnowledgeList = (params?: { page?: number; page_size?: number }): Promise<PaginatedData<KnowledgeFile>> => {
  return request.get('/doctor/knowledge/', { params })
}

export const getKnowledgeIndexes = (): Promise<KnowledgeIndex[]> => {
  return request.get('/doctor/knowledge/indexes/')
}

export const getKnowledgeTags = (): Promise<TagStat[]> => {
  return request.get('/doctor/knowledge/tags/')
}

export const reExtractKnowledge = (knowledgeId: number): Promise<void> => {
  return request.post(`/doctor/knowledge/${knowledgeId}/extract/`)
}

export const deleteKnowledge = (knowledgeId: number): Promise<void> => {
  return request.delete(`/doctor/knowledge/${knowledgeId}/`)
}
