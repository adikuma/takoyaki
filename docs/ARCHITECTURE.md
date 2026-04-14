# Architecture

## System overview

```mermaid
graph TB
    subgraph Renderer["Renderer (React 19)"]
        App[App.tsx]
        Sidebar[Sidebar.tsx + sidebar/*]
        Terminal[Terminal.tsx / xterm.js]
        Review[Review.tsx + ReviewTree.tsx]
        Settings[Settings.tsx]
        Store[zustand store]
        App --- Sidebar
        App --- Terminal
        App --- Review
        App --- Settings
        App --- Store
    end

    subgraph Preload["Preload (contextBridge)"]
        Bridge[window.takoyaki IPC bridge]
    end

    subgraph Main["Main Process (Node.js)"]
        WM[WorkspaceManager]
        TM[TerminalManager / node-pty]
        Hooks[HookSystem]
        Socket[SocketServer / TCP]
        Editor[EditorService]
        Git[GitWorktree]
        WM --- TM
        WM --- Git
        Hooks --- Socket
    end

    Store <-->|ipcRenderer.invoke| Bridge
    Bridge <-->|ipcMain.handle| WM
    Bridge <-->|ipcMain.handle| TM
    Bridge <-->|ipcMain.handle| Hooks
    Bridge <-->|ipcMain.handle| Editor
```

## Pane tree

```mermaid
graph TD
    S1["Split (horizontal)"]
    S1 --> L1["Leaf A<br/>surfaceId: abc<br/>terminalId: t1"]
    S1 --> S2["Split (vertical)"]
    S2 --> L2["Leaf B<br/>surfaceId: def<br/>terminalId: t2"]
    S2 --> L3["Leaf C<br/>surfaceId: ghi<br/>terminalId: t3"]
```

Renders as:

```
┌──────────────┬──────────────┐
│              │     B        │
│     A        ├──────────────┤
│              │     C        │
└──────────────┴──────────────┘
```

Desktop pane focus mode isolates one surface without unmounting the underlying split tree, so resized panel ratios survive when focus mode is toggled off.

## State snapshot flow

```mermaid
sequenceDiagram
    participant User
    participant Renderer
    participant Preload
    participant Main as WorkspaceManager

    User->>Renderer: clicks "split right"
    Renderer->>Preload: window.takoyaki.surface.split()
    Preload->>Main: ipcMain.handle('surface:split')
    Main->>Main: splitFocused() mutates pane tree
    Main->>Main: emitChange()
    Main-->>Preload: workspace:changed (full snapshot)
    Preload-->>Renderer: onChange callback
    Renderer->>Renderer: useStore.setState()
    Renderer->>User: React re-renders
```

## Hook status flow

```mermaid
sequenceDiagram
    participant Claude as Claude Code
    participant Script as takoyaki-notify.js
    participant Socket as SocketServer
    participant Main as Main Process
    participant UI as Renderer

    Claude->>Script: Claude hook event fires
    Script->>Script: reads ~/.takoyaki/socket_addr
    Script->>Socket: TCP connect, JSON-RPC status.update
    Socket->>Main: onStatusUpdate(surfaceId, update)
    Main->>Main: reduce activity and attention state
    Main-->>UI: status:changed broadcast
    UI->>UI: sidebar shows activity or attention glyph
    UI->>UI: toast/sidebar update for the affected project
```

## Terminal data flow

```mermaid
sequenceDiagram
    participant X as xterm.js
    participant P as Preload
    participant PTY as node-pty

    X->>P: onData (user keystroke)
    P->>PTY: terminal.write(id, data)
    PTY->>PTY: shell processes input
    PTY-->>P: onData (shell output)
    PTY-->>P: metadata updates for cwd and title
    P-->>X: snapshot restore plus ordered terminal events
```

## Task / worktree model

```mermaid
graph TD
    P["Project: ai-platform<br/>branch: main<br/>kind: project"]
    T1["Task: auth-refactor<br/>branch: feature/auth-refactor<br/>kind: task"]
    T2["Task: api-v2<br/>branch: feat/api-v2<br/>kind: task"]

    P -->|parentProjectId| T1
    P -->|parentProjectId| T2

    T1 -.-|worktree| W1["../ai-platform-auth-refactor"]
    T2 -.-|worktree| W2["../ai-platform-api-v2"]
```

## Theme system

```mermaid
flowchart LR
    CSS["app.css<br/>:root { --takoyaki-bg: #0a0a0b }<br/>[data-theme=light] { --takoyaki-bg: #f7f6f4 }"]
    Tokens["design.ts<br/>colors.bg = var(--takoyaki-bg)"]
    Components["React components<br/>style={{ background: colors.bg }}"]
    XTerm["xterm.js<br/>getTerminalTheme(mode)<br/>hardcoded hex"]

    CSS --> Tokens --> Components
    CSS -.->|custom event| XTerm

    Toggle["Theme toggle"] -->|localStorage + data-theme| CSS
    Toggle -->|takoyaki-theme-changed event| XTerm
```

## IPC bridge surface

```mermaid
graph LR
    subgraph window.takoyaki
        terminal["terminal<br/>create, open, metadata,<br/>write, resize, destroy, onEvent"]
        workspace["workspace<br/>list, select, close, create,<br/>onChange, createTask, removeTask,<br/>listBranches, setSurfaceFontSize"]
        surface["surface<br/>focus"]
        hooks["hooks<br/>install, test, diagnostics"]
        editor["editor<br/>open, preferences, availability"]
        status["status<br/>onChange"]
        activity["activity<br/>get, onChange"]
        window["window<br/>minimize, maximize, close"]
    end
```

## Review navigation

```mermaid
graph TD
    Snapshot["ReviewSnapshot.files"]
    Tree["buildReviewTree(files)"]
    LeftPane["ReviewTree.tsx<br/>folder tree"]
    DiffPane["Review.tsx<br/>diff pane"]

    Snapshot --> Tree --> LeftPane
    LeftPane -->|select file| DiffPane
```

## Storage locations

```mermaid
graph TD
    subgraph "~/.takoyaki/"
        state["state.json<br/>workspace layout"]
        prefs["preferences.json<br/>default editor"]
        addr["socket_addr<br/>TCP host:port"]
        notify["bin/takoyaki-notify.js<br/>hook script"]
    end

    subgraph "~/.claude/"
        settings["settings.json<br/>hook registration"]
    end

    subgraph "project/.git/"
        tasks["takoyaki-tasks.json<br/>task metadata"]
    end
```

## Security boundaries

```mermaid
graph TB
    subgraph Sandbox["Renderer (sandboxed)"]
        R["contextIsolation: true<br/>nodeIntegration: false<br/>sandbox: true"]
    end

    subgraph Bridge["Preload"]
        IPC["typed IPC only<br/>contextBridge"]
    end

    subgraph Trusted["Main Process"]
        S["socket: 127.0.0.1 only"]
        G["git: execFile with array args"]
        E["editor: PowerShell quoting"]
    end

    Sandbox -->|"window.takoyaki.* API only"| Bridge
    Bridge -->|"ipcMain.handle"| Trusted
    S -.->|"no network exposure"| Trusted
    G -.->|"no shell injection"| Trusted
```
