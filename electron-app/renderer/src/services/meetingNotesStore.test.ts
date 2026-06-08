import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

const originalWindow = globalThis.window
const originalFetch = globalThis.fetch

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
  globalThis.fetch = originalFetch
})

async function loadMeetingNotesStore(seed: string) {
  return import(new URL(`./meetingNotesStore.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

function installMeetingImportEnvironment(responsePayload: unknown) {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async <T = unknown>(channel: string): Promise<T> => {
      if (channel === 'audio:ensure-voice-server') return { success: true } as T
      if (channel === 'settings:get') {
        return {
          llm: {
            providerId: 'deepseek',
            providers: [{
              id: 'deepseek',
              label: 'DeepSeek',
              baseUrl: 'https://api.deepseek.com/v1',
              defaultModel: 'deepseek-chat',
              allowBaseUrlEdit: false,
              authType: 'bearer',
            }],
            apiKeys: { deepseek: 'sk-test' },
            models: { deepseek: 'deepseek-chat' },
          },
        } as T
      }
      return {} as T
    },
    send: () => undefined,
    on: () => undefined,
    off: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init })
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetchCalls }
}

test('importMeetingMediaFile sends meeting media quality parameters and keeps partial summary success usable', async () => {
  const env = installMeetingImportEnvironment({
    status: 'OK',
    data: {
      user_prompt: 'final transcript',
      refine_text: 'fallback summary',
      translation_text: '',
      meeting_structured: {
        version: 1,
        scenario: 'project_sync',
        scenarios: ['project_sync'],
        contentLevel: 'short',
        summary: 'fallback summary',
        topics: [],
        decisions: [],
        actionItems: [{ id: 'action-1', text: 'Alice sends report', source: 'action' }],
        scheduleItems: [],
        risks: [],
        questions: [],
        followUps: [],
        transcriptSegments: [{ index: 1, text: 'final transcript' }],
        source: 'import',
      },
      partial_success: true,
      summary_error: 'llm boom',
    },
  })
  const store = await loadMeetingNotesStore('meeting-import-params')
  const file = new File([new Uint8Array([1, 2, 3])], 'meeting.wav', { type: 'audio/wav' })

  const result = await store.importMeetingMediaFile(file)

  assert.equal(result.success, true)
  assert.equal(result.partialSuccess, true)
  assert.equal(result.transcript, 'final transcript')
  assert.equal(result.summary, 'fallback summary')
  assert.equal(result.structuredResult?.scenario, 'project_sync')
  assert.equal(result.structuredResult?.actionItems[0]?.text, 'Alice sends report')
  assert.equal(result.detail, 'llm boom')

  const formData = env.fetchCalls[0]?.init?.body as FormData
  const parameters = JSON.parse(String(formData.get('parameters')))
  const context = JSON.parse(String(formData.get('audio_context')))
  const metadata = JSON.parse(String(formData.get('audio_metadata')))

  assert.equal(parameters.import_source, 'meeting_media')
  assert.equal(parameters.meeting_notes_quality_profile, 'frontier_minutes')
  assert.equal(parameters.meeting_notes_pipeline, 'extractive_then_synthesize')
  assert.equal(parameters.meeting_module, 'import_file')
  assert.equal(parameters.meeting_capture_profile, 'imported_media')
  assert.equal(parameters.import_processing_profile, 'frontier_import')
  assert.equal(parameters.meeting_output_depth, 'comprehensive_minutes_with_transcript_fallback')
  assert.match(parameters.meeting_scenario_coverage, /voice_memo/)
  assert.equal(parameters.llm.api_key, 'sk-test')
  assert.equal(context.import_source, 'meeting_media')
  assert.equal(context.meeting_module, 'import_file')
  assert.equal(context.meeting_capture_profile, 'imported_media')
  assert.equal(metadata.source, 'meeting_import')
})
