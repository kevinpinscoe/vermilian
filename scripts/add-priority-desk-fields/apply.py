#!/usr/bin/env python3
"""
Add the Priority Desk field model (ADR-0007) to every active YouTrack project.

WHAT AND WHY
------------
Three shared, optional custom fields — see
docs/adr/0007-priority-desk-field-model.md and docs/requirements.md §
Priority Desk in the `vermilian` repo:

  Focus         enum[1], single value "Yes"    unset = not focused
  Focus rank    integer                        unset = unranked; app-valid 1-3
  Why now       string                         human-authored reason

Vermilian enforces the 1-3 range and the at-most-one-issue-per-rank
invariant in its own UI (VERM-4) — this script only creates the schema, as
empty and unconstrained as YouTrack's own field types allow. See the ADR's
"Consequences" section: these are application-level constraints on purpose,
not something to try to encode in YouTrack itself.

TARGETS
-------
Every ACTIVE project — not a fixed list. "Active" means not archived and not
a template project (`template: true`, e.g. TMPL). Schema on TMPL is still
correct to touch: TMPL is built to carry the standard field set so a project
created from it mirrors that set (see the sibling `youtrack.kevininscoe.com`
repo's `scripts/add-host-and-domain-fields/apply.py`, `stage_projects`,
which is the precedent this script's shape is copied from). The project
roster changes without any repo being told
(when-creating-a-youtrack-ticket.md §1), so this queries the live instance
at run time instead of hard-coding project shortNames — unlike that
precedent's `EXISTING_PROJECTS = ["KEVIN", "WORK", "VERM"]`, which predates
most of the 35+ projects live today.

THE ORPHAN-BUNDLE TRAP (Focus only — the one enum field here)
---------------------------------------------------------------
Attaching an enum field to a project makes YouTrack create a brand-new empty
bundle named `<Project>: <Field>` as part of instantiating the attachment,
even when the payload names a different bundle explicitly. See the
`add-host-and-domain-fields` precedent's own docstring for the full
explanation and the 44 pre-existing orphans that pattern already left on
this instance. This script passes the `Focus values` bundle explicitly and
sweeps the empty orphans its own attaches create, exactly like that
precedent — but never touches that script's 44 known orphans, which are a
separate, already-decided matter (frozen by id, see PRE_EXISTING semantics
there).

`Focus rank` and `Why now` are plain (non-bundle) fields, so this trap does
not apply to them.

THE PROJECT-CUSTOM-FIELD $type FOR A NON-BUNDLE FIELD
-------------------------------------------------------
YouTrack's ProjectCustomField hierarchy has a distinct subtype per field
category (EnumProjectCustomField, StateProjectCustomField, ... and a
"Simple" category covering integer/float/string). Rather than hard-code a
guess, `discover_pcf_type()` reads it live off an existing field in the same
category already attached somewhere on the instance — `Progress percent`
(integer) for `Focus rank`, `Notes` (string) for `Why now` — so a wrong
assumption fails loudly instead of writing the wrong shape silently.

Stages are independent and re-runnable:
  fields    — create the Focus bundle + all three prototypes, attach to every active project
  test      — create an issue in KEVIN, set all three fields, read back, delete
  verify    — every active project carries all three fields with the right shape

Standard library only. `--dry-run` works on `fields` and `test`; `verify`
never writes and ignores the flag.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

REFERENCE_PROJECT = "KEVIN"  # used only by the `test` stage

# ---------------------------------------------------------------------------
# The one enum field.
# ---------------------------------------------------------------------------
ENUM_FIELDS = [
    {
        "name": "Focus",
        "type": "enum[1]",
        "bundle": "Focus values",
        "empty_text": "Not focused",
        "values": [
            ("Yes", "This issue is one of the Priority Desk's up-to-three "
                     "focused items in the active workspace. Unset means "
                     "not focused - there is no separate empty value."),
        ],
    },
]

# ---------------------------------------------------------------------------
# The two plain (non-bundle) fields. No orphan-bundle trap, no sweep.
# `probe` names an existing field in the same YouTrack field category, whose
# live ProjectCustomField $type this script copies rather than guesses.
# ---------------------------------------------------------------------------
SIMPLE_FIELDS = [
    {
        "name": "Focus rank",
        "type": "integer",
        "empty_text": "Unranked",
        "probe": "Progress percent",
    },
    {
        "name": "Why now",
        "type": "string",
        "empty_text": None,
        "probe": "Notes",
    },
]

ALL_FIELD_NAMES = [f["name"] for f in ENUM_FIELDS] + [f["name"] for f in SIMPLE_FIELDS]


def log(m):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {m}", flush=True)


class Api:
    def __init__(self, base, token, dry_run=False):
        self.base, self.token, self.dry_run = base.rstrip("/"), token, dry_run
        self.writes = 0

    def _call(self, method, path, payload=None):
        url = f"{self.base}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        for attempt in range(1, 4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read()
                    return json.loads(body) if body else {}
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:400]
                if e.code >= 500 and attempt < 3:
                    time.sleep(3 * attempt)
                    continue
                raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {detail}") from None
            except urllib.error.URLError:
                if attempt < 3:
                    time.sleep(3 * attempt)
                    continue
                raise
        raise RuntimeError(f"{method} {path} failed after 3 attempts")

    def get(self, path):
        return self._call("GET", path)

    def post(self, path, payload):
        if self.dry_run:
            log(f"    DRY-RUN POST {path}")
            log(f"             {json.dumps(payload)[:400]}")
            return {"id": "DRY-RUN"}
        self.writes += 1
        return self._call("POST", path, payload)

    def delete(self, path):
        if self.dry_run:
            log(f"    DRY-RUN DELETE {path}")
            return {}
        self.writes += 1
        return self._call("DELETE", path)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def enum_bundles(api):
    return api.get("/api/admin/customFieldSettings/bundles/enum"
                   "?fields=id,name,values(id,name)&$top=500")


def all_projects(api):
    return api.get("/api/admin/projects"
                   "?fields=id,name,shortName,archived,template&$top=300")


def active_projects(api):
    """Every project that is not archived and not a template project.

    Computed live, not from any hard-coded list — see the module docstring's
    TARGETS section for why.
    """
    projects = all_projects(api)
    active = [p for p in projects if not p.get("archived") and not p.get("template")]
    log(f"{len(projects)} projects total, {len(active)} active "
        f"({len(projects) - len(active)} archived/template excluded)")
    return active


def project_fields(api, project_id):
    return api.get(f"/api/admin/projects/{project_id}/customFields"
                   f"?fields=id,field(id,name),canBeEmpty,emptyFieldText,"
                   f"bundle(id,name),$type&$top=200")


def discover_pcf_type(api, projects, probe_field_name):
    """The live ProjectCustomField $type of an existing field, read off
    whichever active project has it attached first. Used so `Focus rank`
    and `Why now` attach with the $type YouTrack actually expects instead
    of a guessed one - see the module docstring.
    """
    for p in projects:
        for a in project_fields(api, p["id"]):
            if (a.get("field") or {}).get("name") == probe_field_name:
                return a["$type"]
    raise RuntimeError(
        f"could not find '{probe_field_name}' attached to any active project "
        f"to discover its ProjectCustomField $type from")


def sweep_auto_created_bundles(api, before_ids, keep_ids, projects):
    """Delete the empty bundles YouTrack auto-created during this run.

    See the module docstring's orphan-bundle section. Deliberately narrow:
    only bundles that (a) did not exist before this run, (b) are not one
    this script created on purpose, (c) hold zero values, and (d) are
    referenced by no project.
    """
    referenced = set()
    for p in projects:
        for a in project_fields(api, p["id"]):
            bid = (a.get("bundle") or {}).get("id")
            if bid:
                referenced.add(bid)

    removed = 0
    for b in enum_bundles(api):
        if b["id"] in before_ids or b["id"] in keep_ids:
            continue
        if b.get("values"):
            log(f"    NOT sweeping '{b['name']}' ({b['id']}) - holds "
                f"{len(b['values'])} values")
            continue
        if b["id"] in referenced:
            log(f"    NOT sweeping '{b['name']}' ({b['id']}) - a project references it")
            continue
        log(f"    sweeping auto-created empty bundle '{b['name']}' ({b['id']})")
        try:
            api.delete(f"/api/admin/customFieldSettings/bundles/enum/{b['id']}")
            removed += 1
        except RuntimeError as e:
            log(f"    WARNING: could not delete {b['id']}: {e}")
    return removed


def reconcile_enum_attachment(api, project_id, project_label, spec, proto, existing, bundle_id):
    """Create or fix one enum field's attachment on one project."""
    name = spec["name"]
    payload_bundle = {"id": bundle_id, "$type": "EnumBundle"}

    if existing is None:
        payload = {
            "field": {"id": proto["id"], "$type": "CustomField"},
            "canBeEmpty": True,
            "emptyFieldText": spec["empty_text"],
            "bundle": payload_bundle,
            "defaultValues": [],  # explicit - canBeEmpty alone does not stop a stamped default
            "$type": "EnumProjectCustomField",
        }
        log(f"    {project_label}: attaching '{name}'")
        api.post(f"/api/admin/projects/{project_id}/customFields?fields=id", payload)
        return "attached"

    update, why = {}, []
    if (existing.get("bundle") or {}).get("id") != bundle_id:
        update["bundle"] = payload_bundle
        why.append(f"bundle {(existing.get('bundle') or {}).get('id')} -> {bundle_id}")
    if not existing.get("canBeEmpty"):
        update["canBeEmpty"] = True
        why.append("canBeEmpty False -> True")
    if existing.get("emptyFieldText") != spec["empty_text"]:
        update["emptyFieldText"] = spec["empty_text"]
        why.append("emptyFieldText")
    if not update:
        return "ok"
    update["$type"] = "EnumProjectCustomField"
    log(f"    {project_label}: fixing '{name}' - {'; '.join(why)}")
    api.post(f"/api/admin/projects/{project_id}/customFields/{existing['id']}?fields=id", update)
    return "fixed"


def reconcile_simple_attachment(api, project_id, project_label, spec, proto, existing, pcf_type):
    """Create or fix one plain (non-bundle) field's attachment on one project.

    `emptyFieldText: null` is rejected outright by this instance's API
    ("Can't use empty null value text" / no-type-is-invalid) for a
    SimpleProjectCustomField, unlike the enum attach path where a null
    empty_text is never sent in the first place. Established live 2026-09-15:
    `Focus rank` (empty_text "Unranked") attached to every project fine;
    `Why now` (empty_text None) failed on the very first project it tried
    with exactly that error. Omit the key entirely rather than sending null;
    the field is still `canBeEmpty: true`, it just has no placeholder text.
    """
    name = spec["name"]

    if existing is None:
        payload = {
            "field": {"id": proto["id"], "$type": "CustomField"},
            "canBeEmpty": True,
            "$type": pcf_type,
        }
        if spec["empty_text"] is not None:
            payload["emptyFieldText"] = spec["empty_text"]
        log(f"    {project_label}: attaching '{name}'")
        api.post(f"/api/admin/projects/{project_id}/customFields?fields=id", payload)
        return "attached"

    update, why = {}, []
    if not existing.get("canBeEmpty"):
        update["canBeEmpty"] = True
        why.append("canBeEmpty False -> True")
    if spec["empty_text"] is not None and existing.get("emptyFieldText") != spec["empty_text"]:
        update["emptyFieldText"] = spec["empty_text"]
        why.append("emptyFieldText")
    if not update:
        return "ok"
    update["$type"] = pcf_type
    log(f"    {project_label}: fixing '{name}' - {'; '.join(why)}")
    api.post(f"/api/admin/projects/{project_id}/customFields/{existing['id']}?fields=id", update)
    return "fixed"


# ---------------------------------------------------------------------------
# Stage: fields
# ---------------------------------------------------------------------------

def stage_fields(api):
    log("=== Stage: fields ===")
    projects = active_projects(api)

    protos = {f["name"]: f for f in api.get(
        "/api/admin/customFieldSettings/customFields"
        "?fields=id,name,fieldType(id)&$top=300")}

    # --- discover the plain-field $type before creating anything -----------
    simple_pcf_type = {}
    for spec in SIMPLE_FIELDS:
        pcf_type = discover_pcf_type(api, projects, spec["probe"])
        log(f"  '{spec['name']}' will attach as {pcf_type} "
            f"(discovered from '{spec['probe']}')")
        simple_pcf_type[spec["name"]] = pcf_type

    before_ids = {b["id"] for b in enum_bundles(api)}
    keep_ids = set()
    log(f"{len(before_ids)} enum bundles before")

    # --- Focus: bundle, prototype, attach to every active project ----------
    for spec in ENUM_FIELDS:
        name = spec["name"]
        log(f"  field '{name}' ({spec['type']})")

        bundles = {b["name"]: b for b in enum_bundles(api)}
        bundle = bundles.get(spec["bundle"])
        if bundle:
            log(f"    bundle '{spec['bundle']}' exists ({bundle['id']})")
            have = [v["name"] for v in (bundle.get("values") or [])]
            missing = [v for v in spec["values"] if v[0] not in have]
            for vname, vdesc in missing:
                log(f"    adding missing value '{vname}'")
                api.post(f"/api/admin/customFieldSettings/bundles/enum/{bundle['id']}"
                         f"/values?fields=id,name",
                         {"name": vname, "description": vdesc, "$type": "EnumBundleElement"})
            bundle_id = bundle["id"]
        else:
            payload = {"name": spec["bundle"], "values": [
                {"name": v, "description": d, "ordinal": i, "$type": "EnumBundleElement"}
                for i, (v, d) in enumerate(spec["values"])]}
            created = api.post(
                "/api/admin/customFieldSettings/bundles/enum?fields=id,name", payload)
            bundle_id = created.get("id")
            log(f"    created bundle '{spec['bundle']}' -> {bundle_id} "
                f"({len(spec['values'])} values)")
        keep_ids.add(bundle_id)

        proto = protos.get(name)
        if proto:
            log(f"    prototype exists ({proto['id']})")
        else:
            proto = api.post(
                "/api/admin/customFieldSettings/customFields?fields=id,name,fieldType(id)",
                {"name": name,
                 "fieldType": {"id": spec["type"], "$type": "FieldType"},
                 "isAutoAttached": False,
                 "isDisplayedInIssueList": False,
                 "$type": "CustomField"})
            log(f"    created prototype -> {proto.get('id')}")
            protos[name] = proto

        for p in projects:
            label = p["shortName"]
            existing = {(a.get("field") or {}).get("name"): a
                        for a in project_fields(api, p["id"])}
            reconcile_enum_attachment(api, p["id"], label, spec, proto,
                                       existing.get(name), bundle_id)

    # --- Focus rank, Why now: prototype, attach to every active project ----
    for spec in SIMPLE_FIELDS:
        name = spec["name"]
        log(f"  field '{name}' ({spec['type']})")

        proto = protos.get(name)
        if proto:
            log(f"    prototype exists ({proto['id']})")
        else:
            proto = api.post(
                "/api/admin/customFieldSettings/customFields?fields=id,name,fieldType(id)",
                {"name": name,
                 "fieldType": {"id": spec["type"], "$type": "FieldType"},
                 "isAutoAttached": False,
                 "isDisplayedInIssueList": False,
                 "$type": "CustomField"})
            log(f"    created prototype -> {proto.get('id')}")
            protos[name] = proto

        for p in projects:
            label = p["shortName"]
            existing = {(a.get("field") or {}).get("name"): a
                        for a in project_fields(api, p["id"])}
            reconcile_simple_attachment(api, p["id"], label, spec, proto,
                                         existing.get(name), simple_pcf_type[name])

    if api.dry_run:
        return 0

    log("  sweeping bundles YouTrack auto-created during the attaches...")
    swept = sweep_auto_created_bundles(api, before_ids, keep_ids, projects)
    after = len(enum_bundles(api))
    log(f"{len(before_ids)} -> {after} enum bundles "
        f"(+{len(keep_ids - before_ids)} intended, {swept} auto-created swept)")
    if after != len(before_ids | keep_ids):
        log("ERROR: bundle count is not what this run intended. Inspect before re-running.")
        return 1
    return 0


# ---------------------------------------------------------------------------
# Stage: test
# ---------------------------------------------------------------------------

def stage_test(api):
    """Prove the fields actually work: create, set, read back, delete.

    Run against KEVIN, consistent with the add-host-and-domain-fields
    precedent's own choice of "the project that matters" for this kind of
    smoke test. This permanently consumes an issue number; deleting an issue
    does not reclaim it.
    """
    log("=== Stage: test ===")

    required = [
        {"name": "Status", "$type": "StateIssueCustomField",
         "value": {"name": "To do", "$type": "StateBundleElement"}},
        {"name": "Priority", "$type": "SingleEnumIssueCustomField",
         "value": {"name": "Normal", "$type": "EnumBundleElement"}},
    ]

    probe_custom_fields = required + [
        {"name": "Focus", "$type": "SingleEnumIssueCustomField",
         "value": {"name": "Yes", "$type": "EnumBundleElement"}},
        {"name": "Focus rank", "$type": "SimpleIssueCustomField", "value": 1},
        {"name": "Why now", "$type": "SimpleIssueCustomField",
         "value": "Smoke test from add-priority-desk-fields/apply.py"},
    ]

    payload = {
        "project": {"shortName": REFERENCE_PROJECT, "$type": "Project"},
        "summary": "TEST - verifying Focus / Focus rank / Why now",
        "description": ("Temporary issue created by "
                        "scripts/add-priority-desk-fields to verify the three new "
                        "custom fields accept and return values. Deleted by the same run."),
        "customFields": probe_custom_fields,
    }
    created = api.post("/api/issues?fields=id,idReadable", payload)
    issue_id, readable = created.get("id"), created.get("idReadable")
    log(f"  created {readable} ({issue_id})")
    if api.dry_run:
        log("  DRY-RUN: skipping read-back and delete")
        return 0

    got = api.get(f"/api/issues/{issue_id}"
                  f"?fields=idReadable,customFields(name,value(name))")
    values = {}
    for f in got.get("customFields", []):
        v = f.get("value")
        values[f["name"]] = v.get("name") if isinstance(v, dict) else v

    want = {"Focus": "Yes", "Focus rank": 1,
            "Why now": "Smoke test from add-priority-desk-fields/apply.py"}
    failures = []
    for n, expected in want.items():
        have = values.get(n)
        mark = "ok" if have == expected else "MISMATCH"
        log(f"    {n:<12} = {have!r} (wanted {expected!r}) [{mark}]")
        if have != expected:
            failures.append(n)

    log(f"  deleting {readable}")
    api.delete(f"/api/issues/{issue_id}")
    try:
        api.get(f"/api/issues/{issue_id}?fields=id")
        log(f"  ERROR: {readable} still exists after delete")
        failures.append("delete")
    except RuntimeError as e:
        if "404" in str(e):
            log(f"  confirmed {readable} is gone")
        else:
            raise

    if failures:
        log(f"FAILED: {failures}")
        return 1
    log("  test passed")
    return 0


# ---------------------------------------------------------------------------
# Stage: verify
# ---------------------------------------------------------------------------

def stage_verify(api):
    log("=== Stage: verify ===")
    projects = active_projects(api)
    log(f"{len(projects)} active projects: " +
        ", ".join(f"{p['name']} ({p['shortName']})" for p in projects))

    detail = {p["shortName"]: project_fields(api, p["id"]) for p in projects}
    ok = True

    for name in ALL_FIELD_NAMES:
        missing = []
        for short, attachments in detail.items():
            a = next((x for x in attachments
                      if (x.get("field") or {}).get("name") == name), None)
            if a is None:
                missing.append(short)
                continue
            if not a.get("canBeEmpty"):
                ok = False
                log(f"  BAD '{name}' on {short}: canBeEmpty=False")
        if missing:
            ok = False
            log(f"  MISSING '{name}' on: {sorted(missing)}")
        else:
            log(f"  '{name}': present on all {len(projects)} active projects")

    bundles = {b["name"]: b for b in enum_bundles(api)}
    for spec in ENUM_FIELDS:
        b = bundles.get(spec["bundle"])
        if not b:
            ok = False
            log(f"  MISSING bundle '{spec['bundle']}'")
            continue
        have = [v["name"] for v in (b.get("values") or [])]
        want = [v[0] for v in spec["values"]]
        if sorted(have) != sorted(want):
            ok = False
            log(f"  BUNDLE '{spec['bundle']}' values differ: "
                f"missing={sorted(set(want)-set(have))} extra={sorted(set(have)-set(want))}")
        else:
            log(f"  bundle '{spec['bundle']}' ({b['id']}): {len(have)} values, correct")
        used_by = {short for short, attachments in detail.items()
                   if any((a.get("bundle") or {}).get("id") == b["id"]
                          for a in attachments)}
        missing_from = {p["shortName"] for p in projects} - used_by
        if missing_from:
            ok = False
            log(f"    NOT attached (via this bundle) on: {sorted(missing_from)}")

    log("VERIFY OK" if ok else "VERIFY FAILED")
    return 0 if ok else 1


STAGES = {
    "fields": stage_fields,
    "test": stage_test,
    "verify": stage_verify,
}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", required=True, choices=sorted(STAGES))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base = os.environ.get("YOUTRACK_TARGET_URL", "http://127.0.0.1:9000")
    token = os.environ.get("YOUTRACK_TARGET_TOKEN", "")
    if not token:
        print("ERROR: YOUTRACK_TARGET_TOKEN is not set. Run this through run.sh.",
              file=sys.stderr)
        return 2

    api = Api(base, token, dry_run=args.dry_run)
    log(f"target {base}{'  (DRY RUN - no writes)' if args.dry_run else ''}")
    rc = STAGES[args.stage](api)
    log(f"stage '{args.stage}' finished rc={rc} ({api.writes} writes)")
    return rc


if __name__ == "__main__":
    sys.exit(main())
