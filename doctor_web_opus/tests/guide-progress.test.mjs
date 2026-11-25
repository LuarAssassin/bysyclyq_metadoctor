import assert from 'node:assert/strict'
import test from 'node:test'
import { availableChapterIds, getGuideChapter, guideChapters, guideProgressKey, hasGuideVideo, nextGuideChapter, parseGuideProgress, toggleGuideProgress } from '../src/lib/guide-content.ts'

test('progress tolerates invalid storage and retains only known readable chapters', () => {
  for (const raw of [null, '', '{', '{}', 'null', '17']) assert.deepEqual(parseGuideProgress(raw), [])
  assert.deepEqual(parseGuideProgress('["profile","profile","publication","missing",1,"review"]'), ['profile', 'review'])
})

test('completion can be undone and cannot mark planned publishing as complete', () => {
  assert.deepEqual(toggleGuideProgress([], 'profile'), ['profile'])
  assert.deepEqual(toggleGuideProgress(['profile', 'knowledge'], 'profile'), ['knowledge'])
  assert.deepEqual(toggleGuideProgress(['profile'], 'publication'), ['profile'])
})

test('resume selects first unread chapter and invalid chapter values have a safe fallback', () => {
  assert.equal(nextGuideChapter(['profile', 'expression']), 'knowledge')
  assert.equal(nextGuideChapter(availableChapterIds), 'profile')
  assert.equal(getGuideChapter('missing').id, 'profile')
  assert.equal(getGuideChapter('review').id, 'review')
})

test('account progress is separate from demo and other accounts without storing identity in key', async () => {
  const a = await guideProgressKey('doctor-a@example.test')
  assert.equal(a, await guideProgressKey('doctor-a@example.test'))
  assert.notEqual(a, await guideProgressKey('doctor-b@example.test'))
  assert.notEqual(a, await guideProgressKey('doctor-a@example.test', true))
  assert.ok(!a.includes('doctor-a@example.test'))
  assert.equal(await guideProgressKey(''), null)
})

test('video requires a verified source, safe URLs and accessible text', () => {
  const video = { verified: true, src: '/tutorial.mp4', captionsSrc: '/tutorial.vtt', transcript: '操作步骤' }
  assert.equal(hasGuideVideo(video), true)
  assert.equal(hasGuideVideo(null), false)
  assert.equal(hasGuideVideo({ ...video, verified: false }), false)
  assert.equal(hasGuideVideo({ ...video, src: 'javascript:alert(1)' }), false)
  assert.equal(hasGuideVideo({ ...video, src: '//external.test/video.mp4' }), false)
  assert.equal(hasGuideVideo({ ...video, captionsSrc: 'data:text/vtt,WEBVTT' }), false)
  assert.equal(hasGuideVideo({ ...video, transcript: '' }), false)
  assert.equal(guideChapters.some((chapter) => hasGuideVideo(chapter.video)), false)
})
