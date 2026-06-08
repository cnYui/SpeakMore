import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateMeetingNoteTitle, shouldGenerateMeetingNoteTitle } from './meetingNoteTitle'

test('generateMeetingNoteTitle uses structured topic when current title is default', () => {
  const title = generateMeetingNoteTitle({
    title: '实时翻译',
    transcript: '今天我们讨论下周发布计划和测试安排。',
    structuredResult: {
      version: 1,
      scenario: 'project_sync',
      scenarios: ['project_sync'],
      contentLevel: 'medium',
      summary: '本次会议围绕下周发布计划，明确测试安排和负责人。',
      topics: [{ title: '下周发布计划与测试安排', summary: '确认发布节奏。' }],
      decisions: [],
      actionItems: [],
      scheduleItems: [],
      risks: [],
      questions: [],
      followUps: [],
      transcriptSegments: [],
      source: 'recording',
    },
  })

  assert.equal(title, '下周发布计划与测试安排')
})

test('generateMeetingNoteTitle keeps user edited title', () => {
  const title = generateMeetingNoteTitle({
    title: '客户续约复盘',
    transcript: '本次会议讨论了客户续约风险和报价策略。',
  })

  assert.equal(title, '客户续约复盘')
})

test('generateMeetingNoteTitle replaces import file name with content title', () => {
  const title = generateMeetingNoteTitle({
    title: 'meeting.wav',
    transcript: '这次沟通主要围绕门店运营数据复盘，确认下周补货安排。',
    importFile: { name: 'meeting.wav' },
  }, {
    weakTitleHints: ['meeting.wav'],
  })

  assert.equal(title, '门店运营数据复盘')
})

test('generateMeetingNoteTitle falls back without using module defaults', () => {
  const title = generateMeetingNoteTitle({
    title: '新笔记',
    transcript: '',
  }, {
    fallbackTitle: '会议笔记 Today 10:30',
  })

  assert.equal(title, '会议笔记 Today 10:30')
})

test('shouldGenerateMeetingNoteTitle treats detected app default title as weak', () => {
  assert.equal(shouldGenerateMeetingNoteTitle('腾讯会议 新笔记'), true)
})
