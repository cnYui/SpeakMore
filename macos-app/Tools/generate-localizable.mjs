// 从 Electron 版的界面文案（electron-app/renderer/src/i18n.tsx）和原生版专有文案（native-strings.json）
// 生成 Xcode 的 String Catalog：macos-app/SpeakMore/Resources/Localizable.xcstrings。
// 原生版和 Electron 版因此共用同一套中英文文案，改文案只需要改 i18n.tsx 再运行一次本脚本。
//
// 用法：node macos-app/Tools/generate-localizable.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const source = readFileSync(path.join(root, 'electron-app', 'renderer', 'src', 'i18n.tsx'), 'utf8');

// 取出 `export const translations = { ... }` 这个对象字面量（按花括号配对，跳过字符串里的括号）。
const start = source.indexOf('export const translations =');
if (start < 0) throw new Error('i18n.tsx 里找不到 translations');
const open = source.indexOf('{', start);
let depth = 0;
let end = -1;
let quote = null;
for (let index = open; index < source.length; index += 1) {
  const char = source[index];
  if (quote) {
    if (char === '\\') index += 1;
    else if (char === quote) quote = null;
    continue;
  }
  if (char === "'" || char === '"' || char === '`') quote = char;
  else if (char === '{') depth += 1;
  else if (char === '}') {
    depth -= 1;
    if (depth === 0) { end = index; break; }
  }
}
const translations = new Function(`return (${source.slice(open, end + 1)})`)();
const zh = translations['zh-CN'];
const en = translations['en-US'];
const native = JSON.parse(readFileSync(path.join(here, 'native-strings.json'), 'utf8'));

const strings = {};
const unit = (value) => ({ stringUnit: { state: 'translated', value } });
for (const key of Object.keys(zh)) {
  if (!(key in en)) throw new Error(`i18n.tsx 缺少英文文案: ${key}`);
  strings[key] = { extractionState: 'manual', localizations: { 'zh-Hans': unit(zh[key]), en: unit(en[key]) } };
}
for (const [key, value] of Object.entries(native)) {
  if (key in strings) throw new Error(`native-strings.json 里的 key 和 i18n.tsx 重复: ${key}`);
  if (!value['zh-Hans'] || !value.en) throw new Error(`native-strings.json 缺少某种语言: ${key}`);
  strings[key] = { extractionState: 'manual', localizations: { 'zh-Hans': unit(value['zh-Hans']), en: unit(value.en) } };
}

const catalog = { sourceLanguage: 'zh-Hans', strings, version: '1.0' };
const outDir = path.join(root, 'macos-app', 'SpeakMore', 'Resources');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'Localizable.xcstrings'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${Object.keys(strings).length} strings (${Object.keys(zh).length} from i18n.tsx, ${Object.keys(native).length} native)`);
