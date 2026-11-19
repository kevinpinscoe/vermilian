// Binds main/services/workspaceArticles.ts to YouTrack (or, under the e2e
// harness, to the in-memory fake — api/client.ts chooses).

import { youtrack as yt } from './client';
import type { WorkspaceArticleClient } from '../services/workspaceArticles';
import type { WorkspaceMigrationClient } from '../services/workspaceMigration';
import type { StorageActivationClient } from '../services/storageActivation';

export function youtrackWorkspaceArticleClient(url: string, token: string): WorkspaceArticleClient {
  return {
    list: () => yt.listWorkspaceArticles(url, token),
    get: async (articleId) => {
      const a = await yt.getVermilianArticle(url, token, articleId);
      // The service compares only id, content and updated; the title is not re-read.
      return a ? { ...a, summary: '' } : null;
    },
    create: (workspaceId, content) => yt.createWorkspaceArticle(url, token, workspaceId, content),
    update: (articleId, content) => yt.updateVermilianArticle(url, token, articleId, content),
    delete: (articleId) => yt.deleteVermilianArticle(url, token, articleId),
  };
}

// The same client plus the source listing migration reads (VERM-44).
export function youtrackWorkspaceMigrationClient(url: string, token: string): WorkspaceMigrationClient {
  return {
    ...youtrackWorkspaceArticleClient(url, token),
    listSources: () => yt.listMigrationSourceArticles(url, token),
  };
}

// The migration client plus the activation marker (VERM-53).
export function youtrackStorageActivationClient(url: string, token: string): StorageActivationClient {
  return {
    ...youtrackWorkspaceMigrationClient(url, token),
    listMarkers: () => yt.listStorageMarkerArticles(url, token),
    createMarker: (content) => yt.createStorageMarkerArticle(url, token, content),
  };
}
