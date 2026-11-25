// Binds main/services/workspaceArticles.ts to YouTrack (or, under the e2e
// harness, to the in-memory fake — api/client.ts chooses).

import { youtrack as yt } from './client';
import type { ArticleLookupClient, WorkspaceArticleClient } from '../services/workspaceArticles';
import type { WorkspaceMigrationClient } from '../services/workspaceMigration';
import type { StorageActivationClient } from '../services/storageActivation';

export function youtrackWorkspaceArticleClient(url: string, token: string): WorkspaceArticleClient & ArticleLookupClient {
  return {
    list: () => yt.listWorkspaceArticles(url, token),
    get: async (articleId) => {
      const a = await yt.getVermilianArticle(url, token, articleId);
      // The article's actual title: the import's cleanup checks it before deleting (VERM-104).
      return a ? { id: a.id, summary: a.summary ?? '', content: a.content, updated: a.updated } : null;
    },
    // Absence (404) told apart from a failed read, so "gone" is confirmed, never assumed.
    lookup: (articleId) => yt.lookupVermilianArticle(url, token, articleId),
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
