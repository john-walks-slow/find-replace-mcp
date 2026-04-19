# Design Notes

## Product goal

Build a simple but strong MCP server that feels like IDE `find in files` / `replace in files`, while making bulk replacement safer for model-driven workflows.

## Key decisions

### 1. native Node.js file discovery

Instead of shelling out to `rg`, the server discovers files with Node.js and applies include/exclude plus `.gitignore` filtering in-process.

Benefits:

- no external binary dependency
- behavior is fully controlled inside the server
- include/exclude and file size filtering happen in one pipeline
- `.gitignore` support remains available for common repository workflows

### 2. replace is always staged

The server separates search/preview from mutation:

- `find_in_files`
- `prepare_replace_in_files`
- `apply_replace_in_files`
- `inspect_replace_session`

`apply_replace_in_files` only accepts a prepared `sessionId`.

### 3. explicit safety barrier

If the preview is incomplete, the server returns `requires_refinement` and does not mint a valid replace session.

That means the caller cannot “just continue anyway.”

### 4. stale preview protection

Every file in a prepared session is fingerprinted. If any file changes before apply, replacement is rejected and the caller must prepare again.

## Practical scope

This implementation intentionally does **not** try to be a universal refactoring engine.

It is optimized for:

- high quality cross-file text search
- safe staged replacement
- match-level selection
- good default ergonomics for local IDE / agent use
