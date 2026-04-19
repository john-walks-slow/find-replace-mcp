# find-replace-mcp

为 Agent 提供全局搜索替换能力，包含 find_in_files，prepare_replace_in_files，apply_replace_in_files 三个工具。

## 安装

```json
{
  "mcpServers": {
    "find-replace": {
      "command": "npx",
      "args": ["-y", "github:john-walks-slow/find-replace-mcp"]
    }
  }
}
```

依赖 [ripgrep](https://github.com/BurntSushi/ripgrep)，确保 `rg` 命令可用。

## 参数

### find_in_files

| 参数 | 说明 |
|------|------|
| `query` | 搜索内容 |
| `regex` | 启用正则模式 |
| `caseSensitive` | 区分大小写 |
| `wholeWord` | 整词匹配 |
| `include` / `exclude` | glob 过滤 |
| `filePath` | 限定单文件 |
| `basePath` | 指定搜索根目录 |

### prepare_replace_in_files

| 参数 | 说明 |
|------|------|
| `query` | 搜索内容 |
| `replacement` | 替换内容 |
| `regex` | 启用正则模式 |
| `caseSensitive` | 区分大小写 |
| `wholeWord` | 整词匹配 |
| `include` / `exclude` | glob 过滤 |
| `filePath` | 限定单文件 |
| `basePath` | 指定搜索根目录 |
| `encoding` | 非 UTF-8 文件需指定 |
| `maxPreviewMatches` | 预览上限 |

### apply_replace_in_files

| 参数 | 说明 |
|------|------|
| `sessionId` | prepare 返回的 session ID |
| `selectionMode` | `all` / `include_ids` / `exclude_ids` |
| `matchIds` | 选择模式下指定的 match ID 列表 |

## 调用示例

### 搜索

```
find_in_files
  query: "TODO"
  include: ["src/**/*.ts"]
```

### 替换（两步）

第一步预览，拿到 `sessionId`：

```
prepare_replace_in_files
  query: "oldName"
  replacement: "newName"
```

第二步确认执行：

```
apply_replace_in_files
  sessionId: "<from-prepare>"
  selectionMode: "all"
```

支持 `include_ids` / `exclude_ids` 选择性提交。

## 安全机制

- `apply` 只接受 `sessionId`，无法绕过预览
- 预览后文件发生变化则拒绝执行
- 预览结果不完整（被截断）则禁止提交
- 自动识别 UTF-8 和 UTF-16 BOM。其他编码（GBK、Shift_JIS 等）需显式指定 `encoding`。写回时保留原编码。