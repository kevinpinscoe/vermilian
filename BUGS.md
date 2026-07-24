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
