const crypto = require('crypto');

const COMMAND_CATEGORIES = new Set(['default', 'recommended', 'custom']);
const COMMAND_KINDS = new Set(['builtin', 'preset', 'custom']);
const COMMAND_DELIVERIES = new Set(['paste', 'floating-panel', 'none']);
const COMMAND_ACTIONS = new Set(['dictate', 'ask', 'toggle-dictate', 'custom-command']);
const MAX_COMMAND_NAME_LENGTH = 80;
const MAX_COMMAND_DESCRIPTION_LENGTH = 240;
const MAX_COMMAND_PROMPT_LENGTH = 12000;

const TERMINAL_ASSISTANT_PROMPT = `You are a command-line terminal expert proficient in Linux, FFmpeg, OpenSSL, Curl, and other tools.

[Instructions]
The user will input a natural language request. "Compile" it into the most concise, efficient, and directly executable Command Line command.

[Rewriting Formula]
1. Step 1 (Tool Selection): Quickly analyze the requirement and identify the core tool (e.g., awk, sed, ffmpeg, openssl, docker).
2. Step 2 (Parameter Construction): Combine parameters to achieve the function. Prefer using pipe \`|\` to chain commands, aiming for single-line solutions.
3. Step 3 (Absolute Silence): Do not output any explanations, comments, or Markdown formatting (unless line breaks are needed). **Output only the code itself**.`;

const PROFESSIONAL_POLISH_PROMPT = `Rewrite the following content into polished, professional workplace communication.

Rewriting Requirements:
- Show empathy and perspective-taking
- Use a warm, collaborative, and mature tone
- Emphasize win-win outcomes; prefer starting with "we" or "together"
- Offer value before making requests
- Actively listen and affirm the other party
- Create shared goals
- Use positive feedback
- Replace "but" with "and" or "at the same time"
- Preserve the original meaning while making it more professional, respectful, and collaborative
- Output only the rewritten content, no explanations or prefixes.`;

const ABSTRACT_MODE_PROMPT = `[Instructions]
The user will input plain text. Rewrite it in a "mentally unstable, abstract slang, emoji-overloaded" style.

[Rewriting Formula]
1. Step 1 (State Opening): Start unhinged. Use parenthetical action descriptions like (screaming)(twisting)(crawling in darkness).
2. Step 2 (Abstract Transformation): Nouns alone aren't enough—add dramatic modifiers. Don't say "eating," say "violently inhaling carb bombs."
3. Step 3 (Emoji Bombing): Insert a random emoji every 2-3 words, like 🥵✨👠🥺👊.`;

const INTERNET_DARK_PROMPT = `[Instructions]
The user will input casual speech. Rewrite it into internet jargon and corporate buzzword language, treating daily life like a project status report.

[Rewriting Formula]
1. Step 1 (Vocabulary Replacement):
  - eating -> energy replenishment enablement
  - sleeping -> standby retrospective
  - shopping -> resource exchange and conversion
  - chatting -> pipeline alignment
  - if the input is Chinese, prefer familiar internet/workplace jargon such as 破防, 上价值, 对齐颗粒度, 闭环, 抓手, 赋能, 沉淀, 心智, 链路
2. Step 2 (Sentence Restructuring): Use phrases like "through the leverage of..., achieving the closed loop of..., unlocking the underlying logic of..."
3. Step 3 (Elevation): Forcefully elevate the value—make small things sound like "strategic-level iterations."`;

const TRANSLATE_TO_ENGLISH_PROMPT = "Translate the text into natural, fluent English. If it's already in English, just clean it up and improve clarity. Keep proper nouns, brand names, and technical terms unchanged. Output only the translated text without any explanations.";

const DEFAULT_SHORTCUT_COMMANDS = [
  {
    id: 'voice_input',
    name: 'Voice Input',
    description: 'Hold to speak, release to transcribe and paste.',
    prompt: '',
    category: 'default',
    kind: 'builtin',
    action: 'dictate',
    enabled: true,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: ['Right Alt'], display: 'Right Alt', fixed: true },
    delivery: 'paste',
  },
  {
    id: 'smart_assistant',
    name: 'Smart Assistant',
    description: 'Double-tap the voice input shortcut to ask a question and show the answer in the floating panel.',
    prompt: '',
    category: 'default',
    kind: 'builtin',
    action: 'ask',
    enabled: true,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: ['Right Alt', 'x 2'], display: 'Right Alt x 2', fixed: true },
    delivery: 'floating-panel',
  },
  {
    id: 'hands_free_mode',
    name: 'Hands-Free Mode',
    description: 'Press once to start recording, then press again to stop.',
    prompt: '',
    category: 'default',
    kind: 'builtin',
    action: 'toggle-dictate',
    enabled: false,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  },
  {
    id: 'translate_to_english',
    name: 'English Translation Command',
    description: 'A separately bindable shortcut command. Record speech and translate it into natural English.',
    prompt: TRANSLATE_TO_ENGLISH_PROMPT,
    category: 'recommended',
    kind: 'preset',
    action: 'custom-command',
    enabled: true,
    editable: false,
    deletable: false,
    shortcut: { accelerator: 'Tab', keys: ['Tab'], display: 'Tab', fixed: false },
    delivery: 'paste',
  },
  {
    id: 'terminal_assistant',
    name: 'Terminal Assistant',
    description: 'Convert spoken requests into directly executable command-line text.',
    prompt: TERMINAL_ASSISTANT_PROMPT,
    category: 'recommended',
    kind: 'preset',
    action: 'custom-command',
    enabled: false,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  },
  {
    id: 'professional_polish',
    name: 'Professional Polish',
    description: 'Rewrite spoken content into polished workplace communication.',
    prompt: PROFESSIONAL_POLISH_PROMPT,
    category: 'recommended',
    kind: 'preset',
    action: 'custom-command',
    enabled: false,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  },
  {
    id: 'abstract_mode',
    name: 'Abstract Mode',
    description: 'Rewrite text with abstract slang, expressive energy, and emoji-heavy style.',
    prompt: ABSTRACT_MODE_PROMPT,
    category: 'recommended',
    kind: 'preset',
    action: 'custom-command',
    enabled: false,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  },
  {
    id: 'internet_dark',
    name: 'Internet Jargon',
    description: 'Turn casual speech into internet slang and corporate jargon.',
    prompt: INTERNET_DARK_PROMPT,
    category: 'recommended',
    kind: 'preset',
    action: 'custom-command',
    enabled: false,
    editable: false,
    deletable: false,
    shortcut: { accelerator: '', keys: [], display: '', fixed: false },
    delivery: 'paste',
  },
];

const DEFAULT_COMMAND_BY_ID = new Map(DEFAULT_SHORTCUT_COMMANDS.map((command) => [command.id, command]));

function createSmartAssistantShortcut(voiceShortcut = {}) {
  const display = typeof voiceShortcut.display === 'string' && voiceShortcut.display.trim()
    ? voiceShortcut.display.trim()
    : 'Right Alt';
  const keys = Array.isArray(voiceShortcut.keys) && voiceShortcut.keys.length
    ? [...voiceShortcut.keys, 'x 2']
    : ['Right Alt', 'x 2'];
  return {
    accelerator: '',
    keys,
    display: `${display} x 2`,
    fixed: true,
  };
}

function applyDefaultCommandDependencies(commands = []) {
  const nextCommands = commands.map((command) => ({ ...command }));
  const voiceInput = nextCommands.find((command) => command.id === 'voice_input');
  const smartAssistant = nextCommands.find((command) => command.id === 'smart_assistant');

  if (smartAssistant) {
    smartAssistant.shortcut = createSmartAssistantShortcut(voiceInput?.shortcut);
    if (voiceInput && !voiceInput.enabled) {
      smartAssistant.enabled = false;
    }
  }

  return nextCommands;
}

function createId(prefix = 'command') {
  return `${prefix}_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

function normalizeText(value, maxLength = 1000, fallback = '') {
  const normalized = String(value ?? fallback ?? '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

function normalizePrompt(value) {
  return String(value || '').trim().slice(0, MAX_COMMAND_PROMPT_LENGTH);
}

function normalizeShortcut(value = {}) {
  const shortcut = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const accelerator = typeof shortcut.accelerator === 'string' ? shortcut.accelerator.trim() : '';
  const keys = Array.isArray(shortcut.keys)
    ? shortcut.keys.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const display = typeof shortcut.display === 'string' && shortcut.display.trim()
    ? shortcut.display.trim()
    : keys.join(' + ');
  return {
    accelerator,
    keys,
    display,
    fixed: Boolean(shortcut.fixed),
  };
}

function normalizeShortcutCommand(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const kind = COMMAND_KINDS.has(source.kind) ? source.kind : base.kind || 'custom';
  const category = COMMAND_CATEGORIES.has(source.category) ? source.category : base.category || 'custom';
  const action = COMMAND_ACTIONS.has(source.action) ? source.action : base.action || 'custom-command';
  const delivery = COMMAND_DELIVERIES.has(source.delivery) ? source.delivery : base.delivery || 'paste';
  const now = new Date().toISOString();

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : base.id || createId('command'),
    name: normalizeText(source.name ?? base.name, MAX_COMMAND_NAME_LENGTH, base.name || 'Custom Command'),
    description: normalizeText(source.description ?? base.description, MAX_COMMAND_DESCRIPTION_LENGTH),
    prompt: normalizePrompt(source.prompt ?? base.prompt),
    category,
    kind,
    action,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : Boolean(base.enabled),
    editable: typeof source.editable === 'boolean' ? source.editable : Boolean(base.editable ?? kind !== 'builtin'),
    deletable: typeof source.deletable === 'boolean' ? source.deletable : Boolean(base.deletable ?? kind === 'custom'),
    shortcut: normalizeShortcut(source.shortcut || base.shortcut),
    delivery,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : base.updatedAt || now,
  };
}

function mergeDefaultCommand(defaultCommand, persistedCommand = {}) {
  if (!persistedCommand || typeof persistedCommand !== 'object' || Array.isArray(persistedCommand)) {
    return normalizeShortcutCommand(defaultCommand, defaultCommand);
  }

  const persistedPatch = {
    enabled: persistedCommand.enabled,
    shortcut: persistedCommand.shortcut,
    updatedAt: persistedCommand.updatedAt,
  };

  if (defaultCommand.kind === 'custom') {
    persistedPatch.name = persistedCommand.name;
    persistedPatch.description = persistedCommand.description;
    persistedPatch.prompt = persistedCommand.prompt;
    persistedPatch.delivery = persistedCommand.delivery;
  }

  return normalizeShortcutCommand({
    ...defaultCommand,
    ...persistedPatch,
    id: defaultCommand.id,
    category: defaultCommand.category,
    kind: defaultCommand.kind,
    action: defaultCommand.action,
    editable: defaultCommand.editable,
    deletable: defaultCommand.deletable,
  }, defaultCommand);
}

function mergeShortcutCommands(persistedCommands = []) {
  const persistedList = Array.isArray(persistedCommands) ? persistedCommands : [];
  const persistedById = new Map(
    persistedList
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => [item.id, item]),
  );
  const defaults = applyDefaultCommandDependencies(
    DEFAULT_SHORTCUT_COMMANDS.map((command) => mergeDefaultCommand(command, persistedById.get(command.id))),
  );
  const customCommands = persistedList
    .filter((command) => command && typeof command === 'object' && !DEFAULT_COMMAND_BY_ID.has(command.id))
    .map((command) => normalizeShortcutCommand(command, {
      category: 'custom',
      kind: 'custom',
      action: 'custom-command',
      editable: true,
      deletable: true,
      enabled: true,
      delivery: 'paste',
    }))
    .filter((command) => command.name);
  return [...defaults, ...customCommands];
}

function createUpsertPayloadForExisting(existingCommand, payload = {}) {
  const patch = {
    id: existingCommand.id,
    enabled: payload.enabled,
    updatedAt: new Date().toISOString(),
  };

  if (!existingCommand.shortcut?.fixed || existingCommand.id === 'voice_input') {
    patch.shortcut = payload.shortcut;
  }

  if (existingCommand.kind === 'custom') {
    patch.name = payload.name;
    patch.description = payload.description;
    patch.prompt = payload.prompt;
    patch.delivery = payload.delivery;
  }

  return patch;
}

function upsertShortcutCommand(commands, payload = {}) {
  const existing = mergeShortcutCommands(commands);
  const existingCommand = existing.find((command) => command.id === payload?.id);

  if (!existingCommand) {
    const candidate = normalizeShortcutCommand(payload, {
      category: 'custom',
      kind: 'custom',
      action: 'custom-command',
      editable: true,
      deletable: true,
      enabled: true,
      delivery: 'paste',
    });
    return applyDefaultCommandDependencies([candidate, ...existing]);
  }

  return applyDefaultCommandDependencies(existing.map((command) => {
    if (command.id !== existingCommand.id) return command;
    return normalizeShortcutCommand(createUpsertPayloadForExisting(command, payload), command);
  }));
}

function deleteShortcutCommand(commands, id) {
  const existing = mergeShortcutCommands(commands);
  const command = existing.find((item) => item.id === id);
  if (!command || !command.deletable) return existing;
  return existing.filter((item) => item.id !== id);
}

module.exports = {
  DEFAULT_SHORTCUT_COMMANDS,
  MAX_COMMAND_PROMPT_LENGTH,
  TERMINAL_ASSISTANT_PROMPT,
  PROFESSIONAL_POLISH_PROMPT,
  ABSTRACT_MODE_PROMPT,
  INTERNET_DARK_PROMPT,
  TRANSLATE_TO_ENGLISH_PROMPT,
  normalizeShortcut,
  normalizeShortcutCommand,
  mergeShortcutCommands,
  upsertShortcutCommand,
  deleteShortcutCommand,
};
