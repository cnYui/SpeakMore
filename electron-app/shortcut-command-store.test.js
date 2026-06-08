const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ABSTRACT_MODE_PROMPT,
  DEFAULT_SHORTCUT_COMMANDS,
  INTERNET_DARK_PROMPT,
  PROFESSIONAL_POLISH_PROMPT,
  mergeShortcutCommands,
  upsertShortcutCommand,
} = require('./shortcut-command-store');

test('mergeShortcutCommands keeps built-in defaults and persisted enabled state', () => {
  const commands = mergeShortcutCommands([
    {
      id: 'voice_input',
      name: 'Changed name',
      prompt: 'ignored prompt',
      enabled: false,
    },
  ]);
  const voiceInput = commands.find((command) => command.id === 'voice_input');

  assert.equal(voiceInput.name, 'Voice Input');
  assert.equal(voiceInput.prompt, '');
  assert.equal(voiceInput.enabled, false);
});

test('upsertShortcutCommand allows built-in shortcut edits without prompt edits', () => {
  const commands = upsertShortcutCommand([], {
    id: 'hands_free_mode',
    name: 'Ignored',
    prompt: 'ignored',
    enabled: true,
    shortcut: { accelerator: 'F8', keys: ['F8'], display: 'F8' },
  });
  const handsFree = commands.find((command) => command.id === 'hands_free_mode');

  assert.equal(handsFree.name, 'Hands-Free Mode');
  assert.equal(handsFree.prompt, '');
  assert.equal(handsFree.enabled, true);
  assert.equal(handsFree.shortcut.accelerator, 'F8');
});

test('voice input shortcut can be changed and smart assistant follows it', () => {
  const commands = upsertShortcutCommand([], {
    id: 'voice_input',
    shortcut: { accelerator: 'F8', keys: ['F8'], display: 'F8' },
  });
  const voiceInput = commands.find((command) => command.id === 'voice_input');
  const smartAssistant = commands.find((command) => command.id === 'smart_assistant');

  assert.equal(voiceInput.shortcut.accelerator, 'F8');
  assert.equal(voiceInput.shortcut.display, 'F8');
  assert.equal(voiceInput.shortcut.fixed, false);
  assert.equal(smartAssistant.shortcut.display, 'F8 x 2');
  assert.equal(smartAssistant.shortcut.fixed, true);
});

test('smart assistant shortcut cannot be edited directly', () => {
  const commands = upsertShortcutCommand([], {
    id: 'smart_assistant',
    shortcut: { accelerator: 'F9', keys: ['F9'], display: 'F9' },
  });
  const smartAssistant = commands.find((command) => command.id === 'smart_assistant');

  assert.equal(smartAssistant.shortcut.display, 'Right Alt x 2');
  assert.equal(smartAssistant.shortcut.fixed, true);
});

test('smart assistant is disabled when voice input is disabled', () => {
  const commands = upsertShortcutCommand([], {
    id: 'voice_input',
    enabled: false,
  });
  const nextCommands = upsertShortcutCommand(commands, {
    id: 'smart_assistant',
    enabled: true,
  });

  assert.equal(nextCommands.find((command) => command.id === 'voice_input').enabled, false);
  assert.equal(nextCommands.find((command) => command.id === 'smart_assistant').enabled, false);
});

test('preset commands ignore text edits but keep shortcut edits', () => {
  const commands = upsertShortcutCommand([], {
    id: 'professional_polish',
    name: 'Changed name',
    description: 'Changed description',
    prompt: 'Changed prompt',
    shortcut: { accelerator: 'F7', keys: ['F7'], display: 'F7' },
  });
  const command = commands.find((item) => item.id === 'professional_polish');

  assert.equal(command.name, 'Professional Polish');
  assert.equal(command.description, 'Rewrite spoken content into polished workplace communication.');
  assert.equal(command.prompt, PROFESSIONAL_POLISH_PROMPT);
  assert.equal(command.shortcut.display, 'F7');
});

test('upsertShortcutCommand creates editable custom commands', () => {
  const commands = upsertShortcutCommand([], {
    name: 'My command',
    description: 'Run my voice command',
    prompt: 'Rewrite this.',
    shortcut: { accelerator: 'Ctrl+Shift+Y', keys: ['Ctrl', 'Shift', 'Y'], display: 'Ctrl + Shift + Y' },
  });
  const custom = commands[0];

  assert.match(custom.id, /^command_/);
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.category, 'custom');
  assert.equal(custom.editable, true);
  assert.equal(custom.deletable, true);
  assert.equal(custom.prompt, 'Rewrite this.');
});

test('internet jargon preset uses the corrected naming and prompt semantics', () => {
  const command = DEFAULT_SHORTCUT_COMMANDS.find((item) => item.id === 'internet_dark');

  assert.equal(command.name, 'Internet Jargon');
  assert.equal(command.description, 'Turn casual speech into internet slang and corporate jargon.');
  assert.match(INTERNET_DARK_PROMPT, /internet jargon/i);
  assert.match(INTERNET_DARK_PROMPT, /corporate buzzword/i);
  assert.match(INTERNET_DARK_PROMPT, /closed loop/i);
});

test('English translation preset is labeled as a shortcut command, not the built-in translate mode', () => {
  const command = DEFAULT_SHORTCUT_COMMANDS.find((item) => item.id === 'translate_to_english');

  assert.equal(command.name, 'English Translation Command');
  assert.equal(command.description, 'A separately bindable shortcut command. Record speech and translate it into natural English.');
  assert.equal(command.shortcut.display, 'Tab');
});

test('default rewriting prompts preserve requested style markers', () => {
  assert.match(ABSTRACT_MODE_PROMPT, /🥵✨👠🥺👊/u);
  assert.match(ABSTRACT_MODE_PROMPT, /enough—add/);
  assert.match(INTERNET_DARK_PROMPT, /value—make/);
});
