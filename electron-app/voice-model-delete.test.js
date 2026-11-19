const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceBackendClient } = require('./voice-backend-client');
const { registerVoiceModelIpcHandlers } = require('./voice-model-ipc');

function createFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('deleteVoiceModel 向后端 /model/delete 发送模型 id 和缓存目录，并带回更新后的模型列表', async () => {
  const { fetchImpl, calls } = createFetch(() => jsonResponse({
    status: 'idle',
    models: [{ model_id: 'sensevoice-small-int8', cached: false }],
    delete: { deleted: true, freed_bytes: 1024, external_locations: [] },
  }));
  const client = createVoiceBackendClient({ fetchImpl });

  const result = await client.deleteVoiceModel({ modelId: ' sensevoice-small-int8 ', cacheDir: ' D:\\Models ' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/model/delete');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model_id: 'sensevoice-small-int8', cache_dir: 'D:\\Models' });
  assert.equal(result.success, true);
  assert.equal(result.delete.freed_bytes, 1024);
  assert.equal(result.models[0].cached, false);
});

test('deleteVoiceModel 没有 modelId 时不发请求（不能回退成“当前模型”，否则可能误删正在用的）', async () => {
  const { fetchImpl, calls } = createFetch(() => jsonResponse({}));
  const client = createVoiceBackendClient({ fetchImpl });

  const result = await client.deleteVoiceModel({ cacheDir: 'D:\\Models' });

  assert.equal(calls.length, 0);
  assert.equal(result.success, false);
});

test('deleteVoiceModel 把后端拒绝（下载中 409 / 文件被占用 500）的原因带给界面', async () => {
  for (const [status, detail] of [[409, '模型正在下载或加载，请稍后再删除'], [500, '删除模型失败: 文件被占用']]) {
    const { fetchImpl } = createFetch(() => jsonResponse({ detail }, { ok: false, status }));
    const result = await createVoiceBackendClient({ fetchImpl }).deleteVoiceModel({ modelId: 'sensevoice-small' });
    assert.equal(result.success, false, String(status));
    assert.equal(result.detail, detail);
  }
});

test('deleteVoiceModel 后端连不上时返回 unavailable，不抛异常', async () => {
  const client = createVoiceBackendClient({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const result = await client.deleteVoiceModel({ modelId: 'sensevoice-small' });
  assert.equal(result.success, false);
  assert.equal(result.status, 'unavailable');
});

test('voice-model:delete IPC 先确保后端已启动，再把 payload 交给 deleteVoiceModel', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const deleted = [];
  let started = 0;
  registerVoiceModelIpcHandlers({
    ipcMain,
    ensureVoiceBackendStarted: async () => { started += 1; return { success: true }; },
    getVoiceModelStatus: async () => ({}),
    startVoiceModelDownload: async () => ({}),
    deleteVoiceModel: async (payload) => { deleted.push(payload); return { success: true }; },
  });

  assert.ok(handlers.has('voice-model:delete'));
  const result = await handlers.get('voice-model:delete')({}, { modelId: 'sensevoice-small-int8', cacheDir: 'D:\\Models' });

  assert.equal(started, 1);
  assert.deepEqual(deleted, [{ modelId: 'sensevoice-small-int8', cacheDir: 'D:\\Models' }]);
  assert.equal(result.success, true);
});

test('voice-model:delete IPC 后端起不来时直接返回失败，不调用删除', async () => {
  const handlers = new Map();
  let deleteCalls = 0;
  registerVoiceModelIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    ensureVoiceBackendStarted: async () => ({ success: false, detail: '后端未启动' }),
    getVoiceModelStatus: async () => ({}),
    startVoiceModelDownload: async () => ({}),
    deleteVoiceModel: async () => { deleteCalls += 1; return {}; },
  });
  const result = await handlers.get('voice-model:delete')({}, { modelId: 'x' });
  assert.equal(result.success, false);
  assert.equal(deleteCalls, 0);
});
