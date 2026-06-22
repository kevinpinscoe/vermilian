# Connection & Credentials

All connection settings are entered in **Settings → Connection** (accessible from the gear icon in the left rail or by pressing `N` to open settings).

## YouTrack

| Field | What to enter |
|---|---|
| **YouTrack URL** | Base URL of your self-hosted instance, e.g. `https://youtrack.example.com` |
| **API Token** | A permanent token from YouTrack → your avatar → Profile → Authentication → New token |

The token is stored in the OS keychain via Electron `safeStorage` — it is never written to disk in plain text. On Linux, `safeStorage` requires a keyring backend (GNOME Keyring, KWallet, or equivalent); if none is available Vermilian refuses to save and shows an error rather than storing the token unsafely.

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

Required only for **AI create task** and **daily stand-up report** features. If no key is configured those buttons are disabled.

| Field | What to enter |
|---|---|
| **Claude API Key** | An Anthropic API key starting with `sk-ant-…` |
| **AI create model** | Model used for natural-language task extraction (default: Claude Haiku 4.5) |
| **Stand-up model** | Model used for daily stand-up generation (default: Claude Sonnet 4.6) |

Get an API key at [console.anthropic.com](https://console.anthropic.com). The key is stored in the OS keychain alongside the YouTrack token.

## Saving and testing

Click **Save** after entering credentials. Use **Test connection** to verify that Vermilian can reach YouTrack with the provided token before closing Settings.
