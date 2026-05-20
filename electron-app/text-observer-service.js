const { spawn } = require('child_process');
const { createTextObservationSessionManager } = require('./text-observation-session');

function createTextObserverService({
  exePath = '',
  processPlatform = process.platform,
  spawnProcess = spawn,
  fileExists = () => true,
  createSessionManager = createTextObservationSessionManager,
  learnCorrection = async () => undefined,
  logger = console,
  timeoutMs = 120000,
  now = () => new Date().toISOString(),
} = {}) {
  let textObserverProcess = null;
  let textObserverStdoutBuffer = '';

  function handleTextObserverLine(line) {
    try {
      const message = JSON.parse(line);
      if (message.type === 'observed-text') {
        void textObservationManager.handleObservedText(message);
      }
    } catch (error) {
      logger.error?.('解析文本观察 helper 消息失败', error);
    }
  }

  function ensureTextObserverProcess() {
    if (processPlatform !== 'win32') return null;
    if (textObserverProcess && !textObserverProcess.killed) return textObserverProcess;
    if (!exePath || !fileExists(exePath)) return null;

    textObserverProcess = spawnProcess(exePath, [], { windowsHide: true });
    textObserverStdoutBuffer = '';
    textObserverProcess.stdout?.setEncoding?.('utf8');
    textObserverProcess.stdout?.on?.('data', (chunk) => {
      textObserverStdoutBuffer += chunk;
      const lines = textObserverStdoutBuffer.split(/\r?\n/);
      textObserverStdoutBuffer = lines.pop() || '';
      lines.filter(Boolean).forEach(handleTextObserverLine);
    });
    textObserverProcess.on?.('exit', () => {
      textObserverProcess = null;
      textObserverStdoutBuffer = '';
    });
    return textObserverProcess;
  }

  function sendTextObserverMessage(message) {
    const child = ensureTextObserverProcess();
    if (!child || !child.stdin?.writable) return false;
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  const textObservationManager = createSessionManager({
    startNativeObservation: async (session) => {
      const sent = sendTextObserverMessage({
        type: 'observe-start',
        audioId: session.audioId,
        pastedText: session.pastedText,
        timeoutMs: session.timeoutMs,
      });
      return sent ? { success: true } : { success: false, code: 'native_observer_unavailable' };
    },
    stopNativeObservation: async (session) => {
      sendTextObserverMessage({ type: 'observe-stop', audioId: session.audioId });
    },
    learnCorrection: async (candidate) => learnCorrection(candidate),
    now,
    timeoutMs,
  });

  return {
    textObservationManager,
    ensureTextObserverProcess,
    sendTextObserverMessage,
    getProcess: () => textObserverProcess,
  };
}

module.exports = {
  createTextObserverService,
};
