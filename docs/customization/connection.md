# Connection & Credentials

All connection settings are entered in **Settings** (the gear in the top bar or the left rail, or
press `N`). YouTrack is in **Settings → Connection**, the Claude key in **AI (Claude)**, and Jira in
**Jira**.

## Where a credential comes from

Each credential (YouTrack token, Claude key, Jira token) can come from one of three sources,
listed in priority order in Settings:

| Source | What it is |
| --- | --- |
| **Source 1: Shell command** | A command whose stdout is the credential, e.g. `op read "op://Personal/YouTrack/api-token"` |
| **Source 2: File path** | A file whose trimmed content is the credential, e.g. `/run/secrets/youtrack-token` |
| **Source 3: Paste token** | Saved to the OS keyring through Electron `safeStorage`, never in plain text |

On Linux, `safeStorage` needs a keyring backend (GNOME Keyring, KWallet, or equivalent). If none
is available, Vermilian refuses to save the pasted value rather than storing it unsafely.

Credentials never leave the computer they are configured on. They are not synced through
YouTrack, and a value resolved for a request stays in the main process.

## YouTrack

| Field | What to enter |
| --- | --- |
| **YouTrack URL** | Base URL of your self-hosted instance, e.g. `https://youtrack.example.com` |
| **YouTrack username** | Your YouTrack login name |
| **API Token** | A permanent token, from one of the three sources above |

### Generating a YouTrack token

1. Log in to your YouTrack instance.
2. Click your avatar (top right) → **Profile**.
3. Open the **Authentication** tab.
4. Click **New token**, give it a name (e.g. `vermilian`), and set an optional expiry.
5. Copy the token — it is shown only once.

### Verifying access from the terminal

```bash
export YOUTRACK_TOKEN=<your-token>
curl -s -H "Authorization: Bearer $YOUTRACK_TOKEN" \
     -H "Accept: application/json" \
     "https://youtrack.example.com/api/issues?fields=id,summary&\$top=3"
```

A JSON array means the token and URL are correct.

## Claude AI (optional)

Required only for **AI create task**, Priority Desk **recommendations** and the **daily stand-up
report**. If no key is available those controls are disabled, and the tooltip says why.

| Field | What to enter |
| --- | --- |
| **Claude API Key** | An Anthropic API key starting with `sk-ant-…`, from one of the three sources |
| **Model for task creation** | Model used for natural-language task extraction |
| **Model for stand-up reports** | Model used for daily stand-up generation |

Get an API key at [console.anthropic.com](https://console.anthropic.com).

## Jira (optional, read-only)

Vermilian reads Jira and never writes to it.

| Field | What to enter |
| --- | --- |
| **Site URL** | Your Jira Cloud site, e.g. `https://your-site.atlassian.net` |
| **Account email** | The Atlassian account the token belongs to |
| **cloudId** | Filled in by **Test connection**; enter it by hand only if detection fails |
| **Jira API Token** | A classic or scoped Atlassian API token, from one of the three sources |

The site URL, email and cloudId are shared between your computers through the
`_vermilian-jira-overlay` article in YouTrack. The token is not: configure it on each computer.

## Credential references and workspaces

Each workspace names the credentials it uses by **reference** rather than by value:

| Reference | Resolves through |
| --- | --- |
| `youtrack-1` | The YouTrack token sources in **Settings → Connection** |
| `anthropic-1` | The Claude key sources in **Settings → AI (Claude)** |
| `jira-1` | The Jira token sources in **Settings → Jira** |

How they are used depends on the configuration storage mode:

- **Shared configuration (the default):** every workspace uses the YouTrack server and token in
  Settings and the Settings Claude key. If Source 1 is blank or fails, Source 2 is tried, then
  Source 3.
- **Per-workspace storage (after explicit activation):** each workspace uses its own server and
  its own references. **Only the first configured source is used.** If it fails, the request
  fails, naming the workspace, the reference and the source kind, with no fallback to a lower
  source, another reference or another workspace. A workspace with no Claude reference has AI
  features disabled.

Per-workspace storage is never switched on by installing or starting Vermilian. Activation,
joining from another computer, and recovery are documented in `RUNBOOK.md` → *Per-workspace
configuration storage*. Activation checks that every reference resolves on this computer and
refuses, naming the reference, if one does not.

## Saving and testing

Click **Save** after entering credentials. Use **Test connection** in Connection, AI (Claude) and
Jira to check each credential before closing Settings.
