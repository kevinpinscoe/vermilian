# Phase 0 — Dev Environment

## Goal

All tools required to build, run, package, and debug Vermilian are installed on the development machine (Fedora 42 Linux) and verified to work.

## Acceptance criteria

- [ ] Node.js 24 LTS is installed and on `$PATH`
- [ ] pnpm is installed and on `$PATH`
- [ ] A throwaway Electron + React + TypeScript app can be scaffolded with electron-forge, opened with `pnpm start`, and shows a blank window without errors in the console
- [ ] The YouTrack REST API at `https://youtrack.example.com` returns valid JSON when queried with a permanent API token
- [ ] The repo `.gitignore` blocks `node_modules/`, `out/`, `dist/`, and `.env` before any `pnpm install` is run inside the app directory

## Phase 0 is complete when

All five acceptance criteria above are checked off. Begin Phase 1 (SDD design) only after this.

---

## Step-by-step guide

### Step 0.1 — Node.js 24 LTS

**Option A: fnm (Fast Node Manager) — recommended**

Allows per-project Node versions and does not require sudo.

```bash
curl -fsSL https://fnm.vercel.app/install | bash
# Close and reopen terminal (or source the shell profile), then:
fnm install 22
fnm use 22
fnm default 22
node --version   # expect: v24.x.x
npm --version    # bundled with Node
```

**Option B: NodeSource RPM**

```bash
sudo dnf install -y nodejs22
node --version
```

---

### Step 0.2 — pnpm

```bash
corepack enable          # corepack is bundled with Node 22
corepack prepare pnpm@latest --activate
pnpm --version           # expect: 9.x or 10.x
```

---

### Step 0.3 — Verify electron-forge scaffolding works

This is a one-time smoke test. Do not save the test app into this repo.

**pnpm 11 note:** pnpm 11 enables `blockExoticSubdeps` by default, which rejects the git-URL subdependency `@electron/node-gyp` used inside `@electron/rebuild@3.7.x`. Use npm for this smoke test; the actual Vermilian app will use pnpm with a project-level `.npmrc` override (added in Phase 2).

```bash
cd /tmp
npm create electron-app test-vermilian
cd test-vermilian
npm start
# An Electron window titled "Hello World!" should open.
# Check DevTools console (Ctrl+Shift+I) — no errors.
```

Close the window, then remove the test app:

```bash
rm -rf /tmp/test-vermilian
```

**Phase 2 note:** When scaffolding the real Vermilian app with pnpm, first create a `.npmrc` in the project directory containing `block-exotic-subdeps=false`, then run `pnpm create electron-app`.

---

### Step 0.4 — YouTrack permanent API token

1. Log in to `https://youtrack.example.com`
2. Click your avatar (top right) → **Profile**
3. Under **Account Security**, click **Tokens** → **New token**
4. Name: `vermilian-dev` | Scope: YouTrack | Expiry: no expiry
5. Copy the token immediately (it is only shown once)
6. Store it securely — **never commit it**.

Token is stored in OpenBao at `app/YouTrack` (field: `token`).

---

### Step 0.5 — Verify YouTrack REST API access

```bash
export BAO_ADDR=https://openbao.example.com
export BAO_TOKEN=$(cat ~/.environment/.vault-token)
YOUTRACK_TOKEN=$(bao kv get -field=token -mount=app YouTrack)
curl -s \
  -H "Authorization: Bearer ${YOUTRACK_TOKEN}" \
  -H "Accept: application/json" \
  "https://youtrack.example.com/api/issues?fields=id,summary&\$top=3"
```

**Expected:** a JSON array, e.g. `[{"id":"KP-1","summary":"..."},...]`

| HTTP status | Meaning |
|---|---|
| 200 | Token and URL are correct |
| 401 | Token is wrong or expired |
| 000 / connection error | YouTrack URL is unreachable |

---

### Step 0.6 — Gitignore for Electron/Node

Before running `pnpm install` inside the app directory (Phase 2), ensure the repo `.gitignore` contains:

```
# Electron / Node
node_modules/
out/
dist/
.env
*.env
*.env.local
.DS_Store
```

These entries will be added automatically when the app is scaffolded in Phase 2, but confirm they are present before the first install.

---

### Step 0.7 — IDE setup (optional but recommended)

If using VS Code, install these extensions:

| Extension | ID |
|---|---|
| ESLint | `dbaeumer.vscode-eslint` |
| Prettier | `esbenp.prettier-vscode` |
| Tailwind CSS IntelliSense | `bradlc.vscode-tailwindcss` |
| Error Lens | `usernamehw.errorlens` |

```bash
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension usernamehw.errorlens
```

TypeScript support is built into VS Code and does not need a separate extension.
