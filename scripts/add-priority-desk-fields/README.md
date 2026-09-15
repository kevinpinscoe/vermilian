# add-priority-desk-fields

One-time admin migration for [VERM-4](https://youtrack.kevininscoe.com/issue/VERM-4):
adds the `Focus` / `Focus rank` / `Why now` custom fields (ADR-0007,
`docs/adr/0007-priority-desk-field-model.md`) to every active YouTrack project.

**Kevin runs this himself.** Creating/attaching custom-field schema is an
`api/admin/...` write, which is out of scope for the `Claude_Code` AI session
regardless of what its token could technically reach — see
`~/ai/directives/when-creating-a-youtrack-ticket.md` §14. The AI generated
this script; it never executed it.

## Usage

```bash
bash run.sh --stage fields --dry-run   # read the output before the real run
bash run.sh --stage fields
bash run.sh --stage test               # smoke test against KEVIN, then deletes the test issue
bash run.sh --stage verify             # confirms every active project carries all three fields
```

Stages are independent and re-runnable. `verify` never writes and ignores
`--dry-run`.

Targets every project that is not archived and not a template project
(`template: true`, e.g. `TMPL`) — computed live against the instance each
run, not a hard-coded list, because the project roster changes without any
repo being told.

Once this has run and `verify` passes, the app-side field registry
(`app/src/shared/fields.ts`) and the Focus-toggle UI can rely on the fields
existing on every active project.
