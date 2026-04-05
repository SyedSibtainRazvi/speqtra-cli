# @speqtra/cli

Sync tasks from your PM to your coding agent. One command.

```bash
$ speqtra take SPQ-5
✓ Took SPQ-5: Add order status tab to dashboard
  Spec written to .speqtra/active-task.md
  Injected into: CLAUDE.md, .cursor/rules/speqtra-task.mdc
  Synced to server.

  Your coding agent will see this task automatically.
  When done, run `speqtra drop` to clean up.
```

Your PM creates structured tasks in [Speqtra](https://speqtra.dev). You run `speqtra take`. Your coding agent (Claude Code, Cursor, Copilot, Codex) instantly sees the full spec, acceptance criteria, and planning context. No copy-paste. No context switching.

## Install

```bash
npm install -g @speqtra/cli
```

## Quick Start

```bash
# 1. Authenticate
speqtra login

# 2. Link this repo to your Speqtra project
speqtra init

# 3. See your tasks
speqtra list

# 4. Take a task — your agent sees it immediately
speqtra take SPQ-5

# 5. Work with your coding agent...

# 6. Done — mark complete and clean up
speqtra drop
```

## How It Works

**`speqtra take`** does three things:
1. Claims the task and sets it to "in progress" (synced to server immediately)
2. Writes the full spec to `.speqtra/active-task.md`
3. Injects a pointer into your agent's config file (CLAUDE.md, .cursor/rules, AGENTS.md, .github/copilot-instructions.md)

**`speqtra drop`** reverses it:
1. Marks the task "done" (synced to server immediately)
2. Removes the spec file
3. Cleans up all agent config injections

## Daily Workflow

```
speqtra sync          # Pull latest tasks from server
speqtra list          # See your assigned tasks
speqtra take SPQ-5    # Take a task, agent sees it
# ... work with your coding agent ...
speqtra drop          # Done, clean up
speqtra sync          # Push any other changes
```

## Commands

### Daily
| Command | Alias | Description |
|---------|-------|-------------|
| `speqtra take <id>` | | Take a task, write spec for your agent |
| `speqtra drop [id]` | | Drop task, mark done, clean up |
| `speqtra list` | `ls` | List your tasks |
| `speqtra sync` | | Pull from server, push local changes |
| `speqtra show <id>` | | Show task details |

### Status
| Command | Alias | Description |
|---------|-------|-------------|
| `speqtra start <id>` | | Mark as in progress |
| `speqtra close <id>` | `done` | Mark as done |
| `speqtra claim <id>` | | Assign to me + start |

### CRUD
| Command | Alias | Description |
|---------|-------|-------------|
| `speqtra create <summary>` | `c` | Create a task |
| `speqtra update <id>` | `u` | Update a task |
| `speqtra delete <id>` | `rm` | Delete a task |
| `speqtra comment <id> <text>` | `msg` | Add a comment |

### Setup
| Command | Description |
|---------|-------------|
| `speqtra login` | Authenticate with API key |
| `speqtra init` | Link repo to a Speqtra project |
| `speqtra index` | Scan repo for codebase context |

## Agent Integration

Speqtra auto-detects which coding agents you use and injects task context into the right config file:

| Agent | Config file |
|-------|-------------|
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursor/rules/speqtra-task.mdc` |
| Codex | `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |

The injected block is wrapped in `<!-- BEGIN SPEQTRA TASK -->` / `<!-- END SPEQTRA TASK -->` markers and is fully managed by `take` / `drop`.

## Offline-First

All task data is stored locally in a SQLite database (`.speqtra/speqtra.db`). You can create, update, and manage tasks offline. Run `speqtra sync` when you're ready to push changes to the server.

Exception: `take` and `drop` auto-sync to the server because they're coordination events (your team needs to know you claimed or finished a task).

## Machine-Readable Output

Every command supports `--json` for scripting and CI/CD:

```bash
speqtra list --json | jq '.[].summary'
speqtra show SPQ-5 --json
```

## Security Model

Task content (descriptions, planning context, comments) is written directly into agent config files by `speqtra take`. This content comes from authenticated team members via the Speqtra web app. Treat task content as trusted input from your team, the same as you would treat a Jira ticket or Linear issue.

## Shorthand

Use `sp` instead of `speqtra` for speed:

```bash
sp take SPQ-5
sp ls
sp drop
```

## License

MIT
