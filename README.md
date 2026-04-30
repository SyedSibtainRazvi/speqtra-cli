# @speqtra/cli

Sync tasks from your PM to your coding agent. One command.

```bash
$ speqtra take SPQ-5
✓ Took SPQ-5: Add order status tab to dashboard
  Spec written to .speqtra/active-task.md
  Injected into: CLAUDE.md, .cursor/rules/speqtra-task.mdc
  Synced to server.
```

Your coding agent (Claude Code, Cursor, Copilot, Codex) instantly sees the full spec, acceptance criteria, and context. No copy-paste. No context switching.

## Install

Requires Node >= 22.13.

### Option A — Let your coding agent install it (recommended)

Paste this into Claude Code, Codex, Cursor, or any agent CLI:

````text
Install the Speqtra CLI for me. Do exactly this, nothing more:

1. Install globally with whichever package manager I have:
     npm install -g @speqtra/cli
   (or `pnpm add -g`, `bun add -g`, `yarn global add`)

2. Verify the install printed a version:
     sp --version

3. Stop. Tell me it is installed and that I should run `sp login` next.
   Do not run login, init, index, or any other Speqtra command myself.
````

### Option B — Manual

```bash
npm install -g @speqtra/cli
```

## Quick Start (local, no account needed)

```bash
speqtra init --local "My Project"   # Create a local project
speqtra create "Add user auth"      # Create a task
speqtra take MYPR-1                 # Take it — agent sees it
# ... work with your coding agent ...
speqtra drop                        # Done, clean up
```

## Quick Start (with Speqtra account)

Team sync coming soon.

```bash
speqtra login           # Authenticate
speqtra init            # Link repo to your project
speqtra sync            # Pull tasks from server
speqtra take SPQ-5      # Take a task — agent sees it
# ... work with your coding agent ...
speqtra drop            # Done, clean up
speqtra sync            # Push changes
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `speqtra take <id>` | | Take a task, write spec for your agent |
| `speqtra drop [id]` | | Mark done, clean up agent configs |
| `speqtra list` | `ls` | List your tasks |
| `speqtra sync` | | Pull/push task changes |
| `speqtra show <id>` | | Show task details |
| `speqtra start <id>` | | Mark as in progress |
| `speqtra close <id>` | `done` | Mark as done |
| `speqtra claim <id>` | | Assign to me + start |
| `speqtra create <summary>` | `c` | Create a task |
| `speqtra update <id>` | `u` | Update a task |
| `speqtra delete <id>` | `rm` | Delete a task |
| `speqtra comment <id> <text>` | `msg` | Add a comment |
| `speqtra index` | | Scan repo for codebase context |

## Agent Support

Auto-detects and injects task context into:

- **Claude Code** — `CLAUDE.md`
- **Cursor** — `.cursor/rules/speqtra-task.mdc`
- **Codex** — `AGENTS.md`
- **GitHub Copilot** — `.github/copilot-instructions.md`

## Offline-First

All data stored locally in SQLite. Create, update, and manage tasks offline. `speqtra sync` when ready.

## JSON Output

Every command supports `--json` for scripting:

```bash
speqtra list --json | jq '.[].summary'
```

## Shorthand

```bash
sp take SPQ-5
sp ls
sp drop
```

## License

MIT
