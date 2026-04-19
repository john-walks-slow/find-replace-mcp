# smart-find-replace-mcp

一个面向 Agent / IDE 的 MCP server，把 `find in files` 和 `replace in files` 做成更接近 IDE 的体验，同时把批量替换的安全边界明确收进协议层。

## 这版关注什么

- 默认从当前工作目录或客户端提供的 root 开始搜索
- 支持 `basePath` / `filePath` / `include` / `exclude`
- 支持 `regex` / `wholeWord` / `caseSensitive` / `useGitIgnore`
- replace 必须先完整 preview，再通过 `sessionId` apply
- preview 后文件变更、编码变化、preview 不完整都会阻止 apply
- 支持常见编码并在写回时保持原编码与 BOM 形态
- 输出尽量 concise，但 `structuredContent` 仍保留决策所需字段

## 为什么保留 ripgrep

这类问题本质上是“代码库搜索”，不是“自己 walk 文件树然后逐个 grep”。

- `rg --files` 的默认行为更接近开发者对 IDE 搜索的直觉
- `.gitignore`、隐藏文件、二进制文件处理已经很成熟
- 大仓库里性能和稳定性明显更好

这里的设计是：

- literal 模式和 regex 模式都走同一套文本匹配 / preview / apply 语义
- `ripgrep` 只负责文件发现、ignore 行为和 glob 范围

## 安全模型

这里禁止裸 replace。

必须按两阶段执行：

1. `prepare_replace_in_files`
2. 检查返回的全部 matches
3. 再调用 `apply_replace_in_files`

协议层硬限制如下：

- `apply_replace_in_files` 只接受 `sessionId`
- 只有 `previewComplete=true` 且 `applyAllowed=true` 才允许执行
- preview 后文件如果发生变化，会直接拒绝 apply
- preview 不完整时会返回 `requires_refinement`

这不是提示词约束，而是服务本身的行为约束。

## 运行前提

- Node.js（建议使用当前 LTS）
- `ripgrep` 已安装并且 `rg` 在 PATH 中可用

## 快速开始

```bash
npm install
npm run build
npm test
```

运行：

```bash
node dist/index.js
```

## MCP 配置样例

仓库附带了一个最小样例：[examples/mcp-servers.sample.json](examples/mcp-servers.sample.json)。

通用 `stdio` 配置示例：

```json
{
  "mcpServers": {
    "smart-find-replace": {
      "command": "node",
      "args": ["/absolute/path/to/find-replace-mcp/dist/index.js"],
      "cwd": "/absolute/path/to/project-you-want-to-search"
    }
  }
}
```

说明：

- `args[0]` 指向当前仓库 build 之后的 `dist/index.js`
- `cwd` 决定默认搜索根目录
- 如果客户端支持 roots，server 会优先取第一个 `file://` root；否则回退到进程 `cwd`

## Tools

- `find_in_files`
  搜索并返回 concise 文本摘要，以及可直接消费的 `structuredContent`
- `prepare_replace_in_files`
  生成完整替换预览；只有预览完整时才会创建可 apply 的 session
- `inspect_replace_session`
  重新查看某个已准备好的 replace session
- `apply_replace_in_files`
  根据 `sessionId` 执行替换，支持全量或按 match id 选择性提交

## 常用参数

- `query`
  必填，搜索内容
- `basePath`
  指定搜索根目录
- `filePath`
  将范围限制为单文件
- `include` / `exclude`
  glob 范围控制
- `regex`
  开启 JS regex 语义
- `wholeWord`
  字面量整词匹配
- `caseSensitive`
  大小写敏感
- `useGitIgnore`
  默认 `true`，关闭后会忽略 `.gitignore`
- `maxPreviewMatches`
  preview 上限，超过时会强制要求 refine
- `encoding`
  显式指定编码，适用于非自动识别文件

## 典型工作流

### 1) 搜索

```json
{
  "name": "find_in_files",
  "arguments": {
    "query": "TODO",
    "include": ["src/**/*.ts"],
    "exclude": ["**/*.test.ts"],
    "caseSensitive": false,
    "wholeWord": false,
    "regex": false
  }
}
```

### 2) 预览替换

```json
{
  "name": "prepare_replace_in_files",
  "arguments": {
    "query": "foo(\\d+)",
    "replacement": "bar$1",
    "regex": true,
    "include": ["src/**/*.ts"]
  }
}
```

### 3) 只替换选中的 match

```json
{
  "name": "apply_replace_in_files",
  "arguments": {
    "sessionId": "<from-prepare>",
    "selectionMode": "include_ids",
    "matchIds": ["<match-id-1>", "<match-id-2>"]
  }
}
```

### 4) 排除部分 match 再提交

```json
{
  "name": "apply_replace_in_files",
  "arguments": {
    "sessionId": "<from-prepare>",
    "selectionMode": "exclude_ids",
    "matchIds": ["<match-id-to-skip>"]
  }
}
```

### 5) 全部替换

```json
{
  "name": "apply_replace_in_files",
  "arguments": {
    "sessionId": "<from-prepare>",
    "selectionMode": "all"
  }
}
```

## 编码支持

支持的编码：

- `utf-8`
- `utf-16le`
- `utf-16be`
- `windows-1252`
- `gbk`
- `shift_jis`

自动识别：

- `utf-8`
- 带 BOM 的 `utf-16`

其余常见编码需要显式传 `encoding`。写回时会保留原始编码与 BOM 形态。

## 输出风格

- 文本输出只给摘要、文件级概览和少量 sample matches
- `structuredContent.matches` 保留做决策所需字段：
  `id / filePath / line / columnStart / columnEnd / matchText / context / replacementPreview`
- 不暴露 `absolutePath / startOffset / endOffset` 这类执行细节
- 额外提供 `summary / files / nextStep`，方便模型继续调用

## 测试

```bash
npm test
```

当前覆盖重点：

- `.gitignore` / include / wholeWord / caseSensitive
- literal 与 regex 共用同一套文本匹配语义
- preview 不完整时禁止 replace
- session 选择性提交与 `exclude_ids`
- preview 后文件变化或编码变化时拒绝 apply
- 非 UTF-8 文件显式编码处理与原编码写回
- UTF-16 BOM 自动识别与保留
- active session 上限与淘汰策略
- atomic write 失败时临时文件清理

## 当前发布方式

当前仓库以 source-first 方式发布到 GitHub：先 clone，再 `npm install && npm run build`，然后通过本地 `stdio` 配置接入 MCP client。
