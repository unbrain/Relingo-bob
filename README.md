# Relingo Bob

> 参考 [solywsh/bob-relingo](https://github.com/solywsh/bob-relingo) 实现并持续适配新版 Relingo 与 Bob 的翻译插件。

## 功能特性

- **单词查询与词本联动**：
  - 支持 **Relingo 全词本查询**（支持免登录查词）与 **Relingo 个人词本查询**（兼容新版 `langBooks` 与旧版 `books`）。
  - 展示美音/英音音标与有道发音（已修复英式发音 `type=1`）、词性释义、词形变体（含连字符复合词如 `state-of-the-art`）。
  - 支持展示 **掌握状态、词频、词根/原型、英英释义（含例句/同反义词）与词源**。
  - 支持在 Bob 结果卡片中点击 **「已掌握」/「忘记了」/「加入生词本」** 直接同步 Relingo 词本状态（对齐新版 `/api/submitVocabulary`）。
- **多种登录方式**：
  - **邮箱验证码登录**：填邮箱点验证发码，填入验证码再点验证（验证码过期自动重置状态，不再卡死）。
  - **邮箱密码登录**：通过 `/api/login` 换取 Token（密码仅单次请求使用，不落盘）。
  - **Token 直连**：直接填入 `x-relingo-token`。
  - **仅查词（不登录）**：免登录使用全词本查词与本地/自定义兜底翻译。
- **多引擎句子翻译 + 自动兜底**：
  - 支持 Relingo 服务端引擎：`Google（免费默认）`、`OpenAI`、`DeepL`、`DeepSeek`、`Claude`、`Gemini`、`小牛翻译 Niu`。
  - 支持 **MyMemory 免费直连** 与 **自定义 OpenAI 兼容 LLM**（可作为主引擎，也可在 Relingo 未登录 / Credits 不足 / 返回 `403` 时自动兜底）。
- **兼容新版 Bob**：
  - 同时返回 `content`（Bob 1.21.0+）与 `toParagraphs`（旧版兼容），移除已废弃的 `fromParagraphs`。
  - 修复 `appcast.json` 自动检查更新。

## 安装与更新

1. 前往 [Releases](https://github.com/unbrain/Relingo-bob/releases) 下载最新的 `relingo_bob*.bobplugin`。
2. 双击 `.bobplugin` 文件安装到 Bob（已安装 `0.0.1` 的用户可直接覆盖安装，后续版本支持 Bob 内自动检查更新）。
3. 在 Bob「偏好设置 → 服务 → 文本翻译」中添加 **Relingo Bob**，选择登录方式并点击「验证」。
