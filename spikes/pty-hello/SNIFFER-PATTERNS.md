# Sniffer Patterns — `pty-hello` spike (T-DESIGN-003)

This document records the regex patterns the spike's main process uses to
detect Claude Code permission prompts in the PTY data stream, the rationale
behind each, known false-positive risks, and patterns considered but rejected.

> **Production note** — this PTY-level sniffer is a **fallback** signal only.
> The real cockpit will consume claude-code **hooks** (`PreToolUse` /
> `PostToolUse` JSON over stdin/stdout) as the primary, structured signal
> ([Anthropic docs: Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)).
> The sniffer exists to catch interactive TUI prompts that bypass the hooks
> layer (e.g. shell-level confirmations, version drift where a new prompt
> shape lands before hooks coverage). Fallback only; do not rely on it for
> security decisions in production.

---

## Pipeline

1. Each PTY `onData` chunk goes both to xterm (raw, ANSI preserved) and to a
   sniffer pipeline.
2. `strip-ansi@^7` removes ANSI control codes.
3. Cleaned bytes are appended to a per-session **sliding 4 KB buffer**.
4. The buffer is matched against the regex table below on every chunk.
5. On a hit:
   - The match text is **deduplicated** against a `Map<text, lastFiredAt>` —
     identical text fired in the previous **2 seconds** is suppressed (claude
     re-renders prompts on every keystroke; without dedup we'd flood the UI).
   - A `pty:permission` IPC is sent to the renderer.
   - The buffer is cleared so the same trailing prompt doesn't fire twice.
6. On user response (`Allow` / `Deny`), main writes `y\n` or `n\n` to the PTY.

## Shipped patterns

| Kind | Regex | Intended catch | False-positive risk |
|---|---|---|---|
| `allow_yn` | `/Allow .+\? \(y\/n\)/i` | Classic claude-code "Allow Edit foo.ts? (y/n)" | A shell command outputting a similar phrase (e.g. `echo "Allow it? (y/n)"`) would match. Acceptable for spike. |
| `do_you_want` | `/Do you want me to/i` | Open-ended claude phrasing — "Do you want me to apply this edit?" | Common conversational English; would match claude's own narration if it ever describes a prompt instead of issuing one. Acceptable. |
| `approve_action` | `/Approve this (edit\|tool\|action)/i` | "Approve this edit", "Approve this tool" buttons in TUI | Low — phrase is specific. |
| `generic_yn_eol` | `/\[y\/n\]\s*$/i` | Very broad fallback for any TUI prompt ending in `[y/n]` | **High** — any tool (apt, git, npm) ending a question with `[y/n]` matches. Spike accepts this; production should scope it to known callers. |
| `continue_yn` | `/Continue\?\s*\(y\/n\)/i` | Multi-step task confirmations | Low. |
| `proceed_yn` | `/Proceed with .+\?\s*\(y\/n\)/i` | "Proceed with deletion of foo? (y/n)" | Low. |
| `numbered_choice` | `/^\s*1\.\s*Yes\b[\s\S]*^\s*2\.\s*No\b/m` | Newer claude-code numbered-choice TUI ("1. Yes  2. No") | Could match a markdown list pasted by the user. Mitigated somewhat by requiring both "1. Yes" AND "2. No" anchored to line starts. |

## Rejected patterns

| Pattern | Why rejected |
|---|---|
| `/y\/n/i` | Too broad — matches mentions of `y/n` in any output, including help text and commit messages. |
| `/\?$/m` | Any question mark at end-of-line — will fire on docstrings, REPL output, every shell prompt that uses `?` as a glob. Useless. |
| `/permission/i` | Fires on system messages like `Permission denied`, `chmod` errors. Inverts the intent. |
| `/Continue/i` (no qualifier) | "Continue" appears in too many normal program outputs (linker hints, npm progress). |
| `/^>.*$/m` | Detecting the claude prompt line itself — would fire constantly during interactive use. |

## Known sharp edges

- **Buffer truncation across chunk boundaries**: a prompt that splits across
  PTY writes is handled by matching the *buffer*, not the chunk. The buffer is
  capped at 4 KB; pathologically long prompts could be missed. Acceptable for
  spike.
- **ANSI cursor moves**: `strip-ansi` removes color/style escapes but cannot
  reverse a `\r` overwrite. If claude rewrites the prompt line in place, the
  buffer will still contain both versions until trimmed.
- **`generic_yn_eol` is greedy**: the broadest pattern; expected to produce
  some false hits. The dedup window keeps the cost bounded.
- **No locale handling**: patterns assume English claude output. A Chinese /
  Japanese claude TUI would not match.
- **Sandbox cwd is `os.tmpdir() + '/pty-hello-sandbox-<rand>'`**: claude is
  launched there to avoid touching real code. The dir is not cleaned up on
  exit (intentional — leaves a forensic trail for the spike).

## Hit-text log (to be filled by Master during empirical run)

| Date | claude version | Captured text (verbatim) | Pattern matched | Outcome |
|---|---|---|---|---|
| | | | | |

## What to do in production

1. **Primary**: implement claude-code hooks. Configure `PreToolUse` to emit a
   structured JSON event over stdin to the cockpit; the cockpit replies via
   stdout to allow/deny. This is the supported, stable contract.
2. **Secondary (this sniffer)**: keep as a defense-in-depth fallback for
   prompts that bypass hooks (interactive TUI confirmations the hooks layer
   doesn't cover, shell-level `[y/n]` from sub-tools claude invokes).
3. **Telemetry**: log every hit with `kind`, matched text, and whether the
   user chose Allow/Deny. Use it to tune patterns over time.
4. **Scope `generic_yn_eol` to known parents**: only fire it when the
   foreground process group looks like claude or one of its known children.
