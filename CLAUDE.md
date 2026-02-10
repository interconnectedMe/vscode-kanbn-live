# CLAUDE.md — vscode-kanbn-live

## Build & Install

```bash
# Full cycle: build → package → install
./reinstall.sh

# Or manually:
npm run build
npx @vscode/vsce package          # produces .vsix
# Install via VS Code UI: Ctrl+Shift+P → "Extensions: Install from VSIX..."
```

### Critical Packaging Rules

- **NEVER use `--no-dependencies`** with `vsce package`. The extension host code (`ext-src/`) requires `@basementuniverse/kanbn` and other `node_modules` at runtime. Without them, `activate()` throws and all commands fail with "command not found".
- **Always bump the version** in `package.json` before reinstalling. VS Code skips extraction if it sees the same version already installed.
- **Use "Install from VSIX..." in the UI** (Ctrl+Shift+P), not `code --install-extension`. The CLI doesn't update VS Code profile extension registries, so the extension may appear installed but not activate in the active profile.
- After install, **Reload Window** (or restart VS Code) is required.

### VS Code Profiles Gotcha

VS Code profiles maintain separate `extensions.json` files at `~/.config/Code/User/profiles/*/extensions.json` that override the global `~/.vscode/extensions/extensions.json`. If an extension shows as installed but commands aren't found:
1. Check if the user has profiles enabled
2. The `reinstall.sh` script patches profile registries automatically
3. Worst case: uninstall via UI, delete the extension directory, reinstall via UI

## Architecture

- `ext-src/` — Extension host code (runs in Node.js, has access to VS Code API)
  - `extension.ts` — Activation, command registration, board cache
  - `KanbnBoardPanel.ts` — Board webview, message handlers (move, sort, bulkMove, bulkArchive)
  - `KanbnTaskPanel.ts` — Task editor webview
  - `KanbnBurndownPanel.ts` — Burndown chart webview
- `src/` — Webview React app (runs in webview iframe, no VS Code API)
  - `Board.tsx` — Main board component, multi-select state, bulk toolbar, help popover
  - `TaskItem.tsx` — Card component, drag-and-drop, selection handling
  - `index.css` — All styles including multi-select, bulk toolbar, help popover
  - `vscode.ts` — Bridge to post messages to extension host
- `build/` — CRA build output (webview assets + compiled ext-src)

## Key Patterns

### react-beautiful-dnd and Click Events
`react-beautiful-dnd`'s `dragHandleProps` includes an `onMouseDown` handler that captures mouse events before `onClick` fires. To intercept Ctrl/Shift+click for multi-select:
- Use `onMouseDown` (not `onClick`) on the drag handle div
- Check for modifier keys, call `e.preventDefault()` + `e.stopPropagation()` to prevent drag
- Fall through to the original `dragHandleProps.onMouseDown` for normal clicks

### Webview ↔ Extension Host Communication
- Webview → Host: `vscode.postMessage({ command: 'kanbn.xxx', ...data })`
- Host → Webview: `panel.webview.postMessage({ type: 'index', ...data })`
- New message handlers go in `KanbnBoardPanel.ts` switch statement

### ESLint
The project has strict ESLint rules including `object-curly-newline`. Multi-line objects in arrays may need explicit interface types and reformatting to satisfy the linter.

## Files to Ignore in Git
- `*.vsix` — Build artifacts (gitignored)
