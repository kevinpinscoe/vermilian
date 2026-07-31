# Bugs

No formal issue tracker yet (GitHub Issues may replace this file later). Each
entry is a short public summary; full investigation notes and reproduction
details live privately outside this repo's tracked history.

## BUG-001: Credential shell-command source can fail silently, with no in-app way to recover

The shell-command credential source (Settings → Connection → token/key
"Command") can end up unable to actually authenticate — while the app still
reports it as "configured" — with no clear error and no way back to a
working state short of manually editing local config files. Restarting the
app alone does not fix it.

Also requesting: an in-app "factory reset" action for exactly this kind of
stuck state. Today Settings → Advanced → "Reset to defaults" intentionally
preserves saved credentials, so it does not help here.

Status: root-caused, not yet fixed. See `private/bugs/BUG-001.md` (not
tracked in this public repo) for full detail.

## BUG-002: Shared workspace config can be corrupted by one stale machine and break every machine

The `_vermilian-config` YouTrack Article — the mechanism that syncs
workspace/folder/project layout across every machine pointed at the same
YouTrack instance — could be overwritten with stale project ids by a single
machine whose local cache hadn't caught up with a YouTrack rebuild (rebuilds
reassign project ids even when names are unchanged). Every other machine
then inherited the corruption on its next launch, so a problem introduced on
one laptop silently broke the app everywhere.

Status: fixed in v1.2.8 (self-healing stale-id pruning on save, a startup
race fix so a not-yet-loaded Article can't be shadowed by a stale local
file, and a manual "Force resync from server" recovery action in Settings →
Advanced). See `private/bugs/BUG-002.md` (not tracked in this public repo)
for full detail.
