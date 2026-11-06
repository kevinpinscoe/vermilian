/**
 * Preflight: every check that must pass before a live scenario mutates
 * anything. Read-only. A failed check makes every live scenario Blocked with
 * the check's reason — never skipped, never passed.
 *
 * The isolation rule it enforces: Vermilian finds its server-side
 * configuration by the article title `_vermilian-config`, and creates one in
 * the VERM project when it finds none. A separate local profile isolates
 * nothing on the server. So the application identity must be a dedicated
 * account that (a) cannot see any `_vermilian-config` article and (b) cannot
 * create articles in VERM. Then the app runs on its local profile alone and
 * cannot read or write Kevin's configuration. Relying on a write being
 * refused (403) is not accepted as isolation.
 */

import { appIdentityClient, Client, HarnessError, verifierClient } from './clients';
import { buildIdentity, BuildIdentity } from './identity';
import { auditProject, findProject, Project, timeTrackingEnabled } from './server';
import { LiveSettings, missingSettings } from './settings';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Preflight {
  ok: boolean;
  checks: Check[];
  blockedReason: string | null;
  build: BuildIdentity;
  appLogin: string | null;
  verifierLogin: string | null;
  project: Project | null;
  rejectProject: Project | null;
}

const CONFIG_ARTICLE = '_vermilian-config';
const ARTICLE_PROJECT = 'VERM';

interface PermEntry { permission: { key: string }; global: boolean; projects: Array<{ shortName: string }> | null }

async function permissions(client: Client): Promise<PermEntry[]> {
  const res = await client.request<PermEntry[]>('GET', '/api/permissions/cache?fields=permission(key),global,projects(shortName)');
  if (res.status !== 200) throw new HarnessError(`${client.label} cannot read its own permissions (HTTP ${res.status})`);
  return res.body;
}

function has(perms: PermEntry[], key: string, project: string): boolean {
  return perms.some((p) => p.permission.key === `JetBrains.YouTrack.${key}` && (p.global || (p.projects ?? []).some((x) => x.shortName === project)));
}

async function visibleConfigArticles(client: Client): Promise<number> {
  let count = 0;
  for (let skip = 0; skip < 10_000; skip += 100) {
    const res = await client.request<Array<{ summary: string }>>('GET', `/api/articles?fields=summary&$top=100&$skip=${skip}`);
    if (res.status !== 200) throw new HarnessError(`${client.label} article listing returned HTTP ${res.status}`);
    count += res.body.filter((a) => a.summary === CONFIG_ARTICLE).length;
    if (res.body.length < 100) return count;
  }
  throw new HarnessError('article listing did not end within 10,000 articles');
}

/** Project ids Kevin's own configuration assigns to any workspace. */
async function projectsInKevinsWorkspaces(verifier: Client): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let skip = 0; skip < 10_000; skip += 100) {
    const res = await verifier.request<Array<{ summary: string; content: string }>>('GET', `/api/articles?fields=summary,content&$top=100&$skip=${skip}`);
    if (res.status !== 200) throw new HarnessError(`verifier article listing returned HTTP ${res.status}`);
    for (const a of res.body.filter((x) => x.summary === CONFIG_ARTICLE)) {
      try {
        const cfg = JSON.parse(a.content) as { workspaces?: Array<{ folders?: Array<{ projectIds?: string[] }> }> };
        for (const w of cfg.workspaces ?? []) for (const f of w.folders ?? []) for (const p of f.projectIds ?? []) ids.add(p);
      } catch {
        throw new HarnessError('the shared _vermilian-config article is not valid JSON; cannot prove the harness projects are outside it');
      }
    }
    if (res.body.length < 100) return ids;
  }
  return ids;
}

export async function runPreflight(s: LiveSettings): Promise<Preflight> {
  const checks: Check[] = [];
  const add = (name: string, okay: boolean, detail: string) => { checks.push({ name, ok: okay, detail }); return okay; };
  const result: Preflight = {
    ok: false, checks, blockedReason: null,
    build: buildIdentity(s.executable),
    appLogin: null, verifierLogin: null, project: null, rejectProject: null,
  };
  const finish = () => {
    const failed = checks.find((c) => !c.ok);
    result.ok = !failed;
    result.blockedReason = failed ? `${failed.name}: ${failed.detail}` : null;
    return result;
  };

  // 1. Local prerequisites.
  const missing = missingSettings(s);
  if (!add('settings', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'all required variables set')) return finish();
  if (!add('executable', result.build.executableExists && result.build.asarSha256 !== null,
    `${s.executable} (${result.build.kind}, app.asar ${result.build.asarSha256 ?? 'not found'})`)) return finish();
  for (const k of Object.keys(process.env).filter((x) => x.startsWith('VERMILIAN_E2E'))) {
    // The launcher strips these anyway; a set value here usually means a
    // shell left over from the deterministic suite, worth surfacing.
    add('fake-service variables', true, `${k} is set in the runner's environment and will be removed from the app's`);
  }

  try {
    // 2. Identities.
    const verifier = verifierClient(s);
    const app = appIdentityClient(s);
    const vMe = await verifier.request<{ login: string }>('GET', '/api/users/me?fields=login');
    if (!add('verifier identity', vMe.status === 200, `HTTP ${vMe.status}, login ${vMe.body?.login ?? '?'}`)) return finish();
    result.verifierLogin = vMe.body.login;

    const aMe = await app.request<{ login: string }>('GET', '/api/users/me?fields=login');
    if (!add('application identity reachable', aMe.status === 200, `HTTP ${aMe.status} from ${s.appUrl}`)) return finish();
    result.appLogin = aMe.body.login;
    if (!add('application identity is the designated harness account', aMe.body.login === s.appLogin,
      `token resolves to "${aMe.body.login}", expected "${s.appLogin}"`)) return finish();
    const forbidden = [...s.forbiddenLogins, result.verifierLogin];
    if (!add('application identity is dedicated', !forbidden.includes(aMe.body.login),
      `"${aMe.body.login}" must not be any of: ${forbidden.join(', ')}`)) return finish();

    // 3. Server-side configuration isolation.
    const seen = await visibleConfigArticles(app);
    if (!add('config article not visible to the app identity', seen === 0,
      seen ? `${seen} ${CONFIG_ARTICLE} article(s) visible — the app would read and write shared configuration` : 'none visible; the app will use its isolated local profile')) return finish();
    const appPerms = await permissions(app);
    const canCreate = has(appPerms, 'CREATE_ARTICLE', ARTICLE_PROJECT);
    if (!add('app identity cannot create the config article', !canCreate,
      canCreate ? `holds CREATE_ARTICLE in ${ARTICLE_PROJECT}; on finding no config it would create a second ${CONFIG_ARTICLE}` : `no CREATE_ARTICLE in ${ARTICLE_PROJECT}`)) return finish();

    // 4. Projects: same server for both clients, outside Kevin's workspaces, right time-tracking state.
    const kevins = await projectsInKevinsWorkspaces(verifier);
    for (const [label, sn, wantTracking] of [['harness project', s.project, true], ['rejection project', s.rejectProject, false]] as const) {
      const viaVerifier = await findProject(verifier, sn);
      const viaApp = await findProject(app, sn);
      if (!add(`${label} ${sn} exists`, Boolean(viaVerifier && viaApp),
        `verifier ${viaVerifier ? 'sees' : 'does not see'} it; app identity ${viaApp ? 'sees' : 'does not see'} it`)) return finish();
      if (!add(`${label} is the same project for both clients`, viaVerifier!.id === viaApp!.id,
        `verifier id ${viaVerifier!.id}, app id ${viaApp!.id} — different ids mean different servers`)) return finish();
      if (!add(`${label} is outside Kevin's workspaces`, !kevins.has(viaVerifier!.id),
        kevins.has(viaVerifier!.id) ? `${sn} is assigned to a workspace in the shared config; its fixtures would appear on Kevin's desk` : 'not assigned to any shared workspace')) return finish();
      const tracking = await timeTrackingEnabled(verifier, viaVerifier!.id);
      if (!add(`${label} time tracking ${wantTracking ? 'enabled' : 'disabled'}`, tracking === wantTracking,
        `time tracking reads ${tracking === null ? 'unreadable' : tracking ? 'enabled' : 'disabled'}`)) return finish();
      const appP = await permissions(app);
      const verP = await permissions(verifier);
      const need: Array<[Client, PermEntry[], string]> = [
        [app, appP, 'READ_ISSUE'], [app, appP, 'UPDATE_ISSUE'],
        [verifier, verP, 'READ_ISSUE'], [verifier, verP, 'CREATE_ISSUE'], [verifier, verP, 'UPDATE_ISSUE'],
      ];
      if (wantTracking) need.push([app, appP, 'CREATE_WORK_ITEM'], [verifier, verP, 'READ_WORK_ITEM']);
      for (const [c, perms, key] of need) {
        if (!add(`${c.label} ${key} on ${sn}`, has(perms, key, sn), has(perms, key, sn) ? 'granted' : 'missing')) return finish();
      }
      const audit = await auditProject(verifier, sn);
      if (!add(`${label} holds no stray Focus`, audit.problems.length === 0,
        audit.problems.length ? audit.problems.join('; ') : `${audit.fixtures.length} existing fixture(s), no other issue holds Focus`)) return finish();
      if (label === 'harness project') result.project = viaVerifier; else result.rejectProject = viaVerifier;
    }
  } catch (e) {
    add('preflight', false, (e as Error).message);
  }
  return finish();
}
