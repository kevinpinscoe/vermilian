# Contributing to vermilian

## Workflow

This repo is hosted on GitHub (`git@github.com:kevinpinscoe/vermilian.git`) and is a solo personal project. The working pattern is:

- **Design, spec, ADR, docs, and one-off fixes**: commit directly to `main`. All commits are SSH-signed (`commit.gpgsign = true`); unsigned commits should not land on `main`.
- **Substantive feature implementation (Phase 2+) and anything touching `app/src/`**: use a branch from the table below and open a PR for review before merging, even when reviewing your own work — the PR gives a checkpoint to read the diff in one view and run CI before merging.
- **AI-generated content from Claude Code** is committed with `Co-Authored-By: Claude Opus <noreply@anthropic.com>` (or the appropriate model name) in the trailer. The same direct-to-`main` vs. branch-and-PR rule applies based on what the AI changed, not who wrote it.

Steps for branch-and-PR work:

1. Create a branch from `main` using the naming convention below.
2. Add or modify files.
3. Validate any diagrams render correctly (see below).
4. Open a PR; fill in all sections of the template.
5. Self-review the diff before merging.

## Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Architecture diagram | `design/arch-<topic>` | `design/arch-api-layer` |
| UI wireframe | `design/ui-<screen>` | `design/ui-task-list` |
| ADR | `adr/<number>-<slug>` | `adr/0002-state-management` |
| Requirements / specs | `spec/<feature-slug>` | `spec/task-list` |
| Feature implementation | `feat/<feature-slug>` | `feat/task-list` |
| Bug fix | `fix/<short-description>` | `fix/token-refresh` |
| Phase 0 env / tooling | `phase0/<step>` | `phase0/node-setup` |

## Keeping the public repository clean

This repository is public. Employer names, Jira site host names, Jira project keys, work email
addresses and other personal or employer-identifying data must never appear in it: not in code,
tests, fixtures, docs, file names, commit messages or PR text. Use fictional values such as
`example.atlassian.net`, `DEMO-123`, `Workspace A` and `Jane Example`. Local databases and Runway
metadata snapshots must never be committed either.

### The private list

The strings to block are kept in a private list, never in this repository and never in GitHub
(not even as an Actions or Dependabot secret): a check that names the forbidden words would
publish them. The maintainer keeps it in a private companion repository, cloned on each machine
so the list is at:

```text
~/Projects/private/vermilian-private/forbidden-strings.txt
```

Set `FORBIDDEN_PATTERNS_FILE` to use another path. Format: one fixed string per line, matched
case-insensitively; blank lines and `#` comments are ignored. Pull the companion repository to
get the latest list. The list holds identifiers only, never passwords or tokens.

### Pre-push check

`.githooks/pre-push` runs `scripts/check-forbidden-strings.sh --push` before Git publishes
anything. For every commit being pushed, it checks the content and path of each file the commit
adds or changes, and the commit message (annotated tag messages too). A string added in one commit
and removed in a later one is still refused, because the history would publish it. It also
refuses SQLite databases and Runway snapshots, by name or by the SQLite header, so a renamed
snapshot is caught.

- **Fail closed.** If the private list is missing, unreadable or empty, the push is refused.
- **No values in output.** Failures name the commit, file and line, and the pattern's number in
  the list, never the matched text.
- **Wiring.** A shared global hooks path (`core.hooksPath`) whose `pre-push` delegates to a
  repository's `.githooks/pre-push`, or, on a machine with no global hooks path,
  `git config core.hooksPath .githooks` in this repository. Check a machine with
  `bash scripts/check-push-guard.sh`, which changes nothing.
- **Bypass.** `git push --no-verify` skips the check. It is a deliberate human decision only.

Scan the current checkout by hand (for example after the list changes) with
`bash scripts/check-forbidden-strings.sh`.

### PR titles and descriptions

A pre-push hook cannot see a PR title or description: they are typed on GitHub after the push.
Write them to a file, check it, then publish exactly that text:

```bash
bash scripts/check-pr-text.sh pr-body.md
gh pr create --title "..." --body-file pr-body.md
```

The same script reads standard input (`-`). Remember that pushing a branch or opening a PR on a
public repository publishes it at once, and GitHub keeps pull-request refs after a branch is
deleted. Check before publishing, not after.

### Public CI

`.github/workflows/repo-hygiene.yml` runs on every PR and on `main` with no secrets: the
scanner's self-test, and the database check on the tree and on every commit in the PR. It never
sees the private list.

## Diagram conventions

### File naming

- D2 files: `<name>.d2`
- Mermaid files: `<name>.mmd`
- Place architecture diagrams in `docs/architecture/`, wireframes in `docs/design/`

### Rendering — Kroki

POST the raw diagram source to your Kroki instance:

```bash
# D2
curl -s -X POST https://<kroki-host>/d2 \
  -H 'Content-Type: text/plain' \
  --data-binary @path/to/diagram.d2 -o out.svg

# Mermaid
curl -s -X POST https://<kroki-host>/mermaid \
  -H 'Content-Type: text/plain' \
  --data-binary @path/to/diagram.mmd -o out.svg
```

### Rendering — wiki.js

Embed in a wiki.js page using fenced code blocks with the Kroki plugin active:

````
```kroki
d2
<paste D2 source here>
```
````

````
```kroki
mermaid
<paste Mermaid source here>
```
````

Native Mermaid blocks also work if the Mermaid module is enabled in wiki.js:

````
```mermaid
<paste Mermaid source here>
```
````

## AI assistance (Claude Code)

Claude Code is used to generate and iterate on design artifacts. When a PR contains AI-generated content, note the scope in the PR description under the **AI assistance** section of the template. This keeps the design rationale traceable.
