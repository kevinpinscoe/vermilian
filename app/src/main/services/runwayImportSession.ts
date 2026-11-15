// Lifecycle of Runway snapshot imports in the main process (VERM-51).
//
// The IPC handlers delegate here, so the rules below are enforced in the
// main process whatever the renderer does, from however many windows:
//
//   - At most one preview dialog is open at a time.
//   - At most one previewed import is pending; a new preview replaces it.
//   - Once a pending import is confirmed it becomes ACTIVE and owns its
//     staged copy exclusively until the import finishes, succeeds or fails.
//     While an import is active, a preview, a second confirmation and a
//     staging cleanup are all refused or skip its files; a cancel does not
//     touch it. Its staged copy is removed only when the import ends.
//
// No Electron import, so the lifecycle is unit-tested directly.

import { basename } from 'node:path';
import {
  RunwayImportError,
  clearRunwayImportStaging,
  discardStagedSnapshot,
  stageRunwaySnapshot,
  type StagedRunwaySnapshot,
} from './runwayImport';

export const IMPORT_IN_PROGRESS_MESSAGE =
  'A Runway snapshot import is already running; wait for it to finish, then try again';

export interface RunwayImportSessionOptions {
  /** userData/runway-import-staging */
  stagingDir: string;
  /** Stages a chosen file; stageRunwaySnapshot unless a test replaces it. */
  stage?: (sourcePath: string, stagingDir: string) => StagedRunwaySnapshot;
}

export class RunwayImportSession {
  private pending: StagedRunwaySnapshot | null = null;
  private active: StagedRunwaySnapshot | null = null;
  private choosing = false;
  private readonly stagingDir: string;
  private readonly stage: (sourcePath: string, stagingDir: string) => StagedRunwaySnapshot;

  constructor({ stagingDir, stage = stageRunwaySnapshot }: RunwayImportSessionOptions) {
    this.stagingDir = stagingDir;
    this.stage = stage;
  }

  /** True while a confirmed import is running. */
  get importing(): boolean {
    return this.active !== null;
  }

  /** The active import's staged copy, if any (for diagnostics and tests). */
  get activeStaged(): StagedRunwaySnapshot | null {
    return this.active;
  }

  private refuseWhileImporting(): void {
    if (this.active) throw new RunwayImportError('import-in-progress', IMPORT_IN_PROGRESS_MESSAGE);
  }

  /**
   * Opens the file chooser (`choose` resolves to a path, or null when the
   * user cancels) and stages the chosen file as the pending import. Refused
   * while an import is active or another preview dialog is open; checked
   * again after the dialog closes, because an import can be confirmed from
   * another window meanwhile. Never removes an active import's files.
   */
  async preview(choose: () => Promise<string | null>): Promise<StagedRunwaySnapshot | null> {
    this.refuseWhileImporting();
    if (this.choosing) {
      throw new RunwayImportError('import-in-progress', 'A Runway snapshot import preview is already open');
    }
    this.choosing = true;
    try {
      const chosen = await choose();
      if (!chosen) return null;
      this.refuseWhileImporting();
      this.discardPending();
      this.clearStaging();
      const staged = this.stage(chosen, this.stagingDir);
      this.pending = staged;
      return staged;
    } finally {
      this.choosing = false;
    }
  }

  /**
   * Confirms the pending import with `token` and runs it through `run`.
   * The staged copy belongs to this import alone until `run` settles, then
   * it is removed whether the import succeeded or failed. Refused while
   * another import is active, and when there is no matching preview.
   */
  async confirm<T>(token: string, run: (staged: StagedRunwaySnapshot) => Promise<T>): Promise<T> {
    this.refuseWhileImporting();
    const staged = this.pending;
    if (!staged || staged.token !== token) {
      throw new RunwayImportError('no-preview', 'Nothing was imported: preview the snapshot again, then confirm');
    }
    // Synchronous hand-over: from here until `run` settles no other caller
    // can see this snapshot as pending or remove it.
    this.pending = null;
    this.active = staged;
    try {
      return await run(staged);
    } finally {
      this.active = null;
      discardStagedSnapshot(staged);
    }
  }

  /** Discards the pending preview with `token`. Never affects an active import. */
  cancel(token: string): void {
    if (this.pending && this.pending.token === token) this.discardPending();
  }

  /** On quit: drops the pending preview. An active import cleans up after itself. */
  shutdown(): void {
    this.discardPending();
  }

  /** Removes leftover staged copies, except the active import's. */
  clearStaging(): void {
    clearRunwayImportStaging(this.stagingDir, this.active ? [basename(this.active.stagedPath)] : []);
  }

  private discardPending(): void {
    discardStagedSnapshot(this.pending);
    this.pending = null;
  }
}
