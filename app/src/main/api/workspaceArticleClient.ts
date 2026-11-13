// Binds main/services/workspaceArticles.ts to YouTrack (or, under the e2e
// harness, to the in-memory fake — api/client.ts chooses).

import { youtrack as yt } from './client';
import type { WorkspaceArticleClient } from '../services/workspaceArticles';

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
  };
}
