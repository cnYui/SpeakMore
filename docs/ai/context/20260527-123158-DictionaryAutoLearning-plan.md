# 词典自动学习误判修复计划

## 背景

词典页候选中出现了整句级映射，例如“那如果我是语音输入的话...”被学习成“问问 Gemini”。这不是前端把词条对应错了，而是自动学习候选提取阶段已经把整段改写识别成了 `wrong -> correct` 候选。

## 根因

`electron-app/text-correction-learning.js` 的 `extractCorrectionCandidates()` 在无法用词级分段确认短词替换时，会回退到字符级前后缀差异提取。对于“整段粘贴文本被用户替换为短文本”的场景，公共前后缀为空，回退逻辑会把整段原文和整段新文本作为候选。

`isLearnableCorrection()` 当前只按长度和 ASCII 粗略判断。只要任一侧包含 `Gemini`、`sayso.cn`、`Windows` 等 ASCII token，就容易绕过中文短语长度限制，导致整句重写进入候选词典。

## 设计

- 自动学习只学习短词或短语级纠错，不学习整句改写、提问、命令或摘要结果。
- 有上下文锚点的替换继续允许，例如“我在使用 client to api 写接口”到“我在使用 Client2API 写接口”。
- 无上下文锚点的整段替换只允许两侧都是短词/短语级候选，避免把完整句子替换成短命令时污染词典。
- 前端词典页继续只展示候选结果，不展示自动学习过程或观察失败原因。

## 实施计划

1. 在 `text-correction-learning.test.mjs` 增加截图中整句改写误学的回归测试，先确认失败。
2. 在 `text-correction-learning.js` 收紧无上下文整体替换的准入条件。
3. 保留已有短词级纠错、中文词级替换、大小写过滤和多处修改过滤行为。
4. 运行 `node --test electron-app/text-correction-learning.test.mjs` 验证自动学习提取逻辑。

## 验证方式

- `node --test electron-app/text-correction-learning.test.mjs`
- 必要时用截图中的文本手动调用 `extractCorrectionCandidates()`，确认返回空数组。
