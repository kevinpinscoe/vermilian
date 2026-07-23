import React, { useEffect, useRef, useState } from 'react';
import { Text, Button, Tooltip } from '@vibe/core';
import { Sun } from '@vibe/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceNav } from './features/workspace-nav/WorkspaceNav';
import { ProjectBoard } from './features/project-board/ProjectBoard';
import { WorkspaceBoard } from './features/workspace-board/WorkspaceBoard';
import { TaskDetailPanel } from './features/task-detail/TaskDetailPanel';
import { CreateTaskModal } from './features/create-task/CreateTaskModal';
import { AiCreateModal } from './features/create-task/AiCreateModal';
import { StandupModal } from './features/standup/StandupModal';
import { FocusOverlay } from './features/timer/FocusOverlay';
import { BreakBanner } from './features/timer/BreakBanner';
import { SearchBar } from './features/search/SearchBar';
import { useWorkspaceStore } from './stores/workspace';
import { useTimerStore, getTotalWorkMs } from './stores/timer';
import { useToastStore } from './stores/toast';
import { useProjects, useWorkspaceConfig } from './features/workspace-nav/api';
import type { StandupScope, StandupWindow } from '../shared/config';
import type { BoardIssue } from '../shared/workspace';
import styles from './AppShell.module.css';

interface AppShellProps {
  onOpenSettings: () => void;
}

// ─── Conflict dialog ─────────────────────────────────────────────────────────

interface ConflictInfo {
  currentSummary: string;
  newIssueId: string;
  newReadable: string;
  newSummary: string;
}

function TimerConflictDialog({
  info,
  onStopAndStart,
  onKeep,
}: {
  info: ConflictInfo;
  onStopAndStart: () => void;
  onKeep: () => void;
}) {
  return (
    <div className={styles.dialogOverlay}>
      <div className={styles.dialog}>
        <Text type="text1" weight="bold">Timer already running</Text>
        <Text type="text2">
          A timer is running on "{info.currentSummary}". Stop it and start a new one on
          "{info.newSummary}"?
        </Text>
        <div className={styles.dialogActions}>
          <Button kind="secondary" onClick={onKeep}>Keep current running</Button>
          <Button color="negative" onClick={onStopAndStart}>Stop and start new</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Quit-protection dialog ───────────────────────────────────────────────────

function QuitDialog({
  summary,
  elapsedMin,
  onKeep,
  onStopAndQuit,
  logging,
}: {
  summary: string;
  elapsedMin: number;
  onKeep: () => void;
  onStopAndQuit: () => void;
  logging: boolean;
}) {
  return (
    <div className={styles.dialogOverlay}>
      <div className={styles.dialog}>
        <Text type="text1" weight="bold">Timer running — quit?</Text>
        <Text type="text2">
          Timer running on "{summary}" — {elapsedMin} min elapsed. Stop the timer before
          quitting?
        </Text>
        <div className={styles.dialogActions}>
          <Button kind="secondary" onClick={onKeep} disabled={logging}>
            Keep working
          </Button>
          <Button color="negative" onClick={onStopAndQuit} loading={logging}>
            Stop timer &amp; quit
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({ onOpenSettings }: AppShellProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeProjectShortName = useWorkspaceStore((s) => s.activeProjectShortName);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const selectedIssueId = useWorkspaceStore((s) => s.selectedIssueId);
  const setSelectedIssue = useWorkspaceStore((s) => s.setSelectedIssue);
  const projects = useProjects();
  const workspaceConfig = useWorkspaceConfig();

  const timer = useTimerStore((s) => s.timer);
  const startTimerStore = useTimerStore((s) => s.startTimer);
  const clearTimer = useTimerStore((s) => s.clearTimer);
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showAiCreate, setShowAiCreate] = useState(false);
  const [showStandup, setShowStandup] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [quitDialog, setQuitDialog] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [crossBoardDrop, setCrossBoardDrop] = useState<{
    issue: BoardIssue;
    targetProjectId: string;
    targetProjectName: string;
  } | null>(null);
  const [crossBoardMoving, setCrossBoardMoving] = useState(false);
  const [standupScope, setStandupScope] = useState<StandupScope>('all-workspace');
  const [standupWindow, setStandupWindow] = useState<StandupWindow>('48h');

  const recoveryAttempted = useRef(false);

  // Queries
  const credStatus = useQuery({
    queryKey: ['credentialStatus'],
    queryFn: () => window.vermilian.credentialStatus(),
    staleTime: 60_000,
  });
  const config = useQuery({
    queryKey: ['appConfig'],
    queryFn: () => window.vermilian.getConfig(),
    staleTime: 60_000,
  });

  const hasClaudeKey = credStatus.data?.hasClaudeKey ?? false;
  const dailyNotesFolder = config.data?.dailyNotesFolder ?? '';
  const pomodoro = config.data?.pomodoro ?? { work: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 };
  const soundEnabled = config.data?.soundOnBlockEnd ?? true;
  const defaultWorklogType = config.data?.defaultWorklogType ?? 'Development';

  const activeProject = projects.data?.find((p) => p.id === activeProjectId) ?? null;
  const workspaces = workspaceConfig.data?.workspaces ?? [];

  // Compute project short names for the "All tasks" workspace board
  const activeWorkspace = workspaceConfig.data?.workspaces.find(
    (w) => w.id === activeWorkspaceId,
  ) ?? workspaceConfig.data?.workspaces[0];
  const workspaceProjectIds = new Set(
    activeWorkspace?.folders.flatMap((f) => f.projectIds) ?? [],
  );
  const workspaceShortNames = (projects.data ?? [])
    .filter((p) => workspaceProjectIds.has(p.id))
    .map((p) => p.shortName);
  const workspaceName = activeWorkspace?.name ?? 'Workspace';

  // ─── Initialise from persisted config ──────────────────────────────────────
  useEffect(() => {
    if (config.data) {
      setStandupScope(config.data.standupScope);
      setStandupWindow(config.data.standupWindow);
    }
  }, [config.data]);

  // ─── Recovery: auto-log checkpoint from previous crashed session ────────────
  useEffect(() => {
    if (recoveryAttempted.current) return;
    recoveryAttempted.current = true;

    void (async () => {
      const saved = await window.vermilian.timerReadCheckpoint();
      if (!saved || saved.checkpointWorkMs < 60_000) return;

      const minutes = Math.round(saved.checkpointWorkMs / 60_000);
      const result = await window.vermilian.timerPostWorklog({
        issueId: saved.issueId,
        minutes,
        worklogType: saved.worklogType,
      });

      if (result.ok) {
        await window.vermilian.timerClearCheckpoint();
        showToast('positive', `Logged ${minutes} min for '${saved.issueReadableId}' from your previous session.`, 6000);
      } else {
        showToast('negative', `Could not auto-log previous session: ${result.error ?? 'unknown error'}. Open Settings to retry.`, 8000);
      }
    })();
  
  }, []);

  // ─── Quit-protection IPC listener ──────────────────────────────────────────
  useEffect(() => {
    window.vermilian.onQuitRequested(() => setQuitDialog(true));
  }, []);

  // ─── Sync quit-protection flag to main process ──────────────────────────────
  useEffect(() => {
    void window.vermilian.timerSetQuitProtection(Boolean(timer));
  }, [timer]);

  // ─── OS notification permission ─────────────────────────────────────────────
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;
      // Block shortcuts during focus mode
      if (timer?.phase === 'work') return;
      if ((e.key === 'n' || e.key === 'N') && (activeProject || workspaceShortNames.length > 0)) {
        e.preventDefault();
        setShowCreateTask(true);
      }
      if ((e.key === 'a' || e.key === 'A') && hasClaudeKey && activeProject) {
        e.preventDefault();
        setShowAiCreate(true);
      }
      if ((e.key === 's' || e.key === 'S') && hasClaudeKey) {
        e.preventDefault();
        setShowStandup(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasClaudeKey, activeProject, timer?.phase]);

  // ─── Checkpoint helper (called by FocusOverlay every 5 s) ───────────────────
  function handleCheckpoint() {
    if (!timer) return;
    void window.vermilian.timerCheckpoint({
      issueId: timer.issueId,
      issueReadableId: timer.issueReadableId,
      summary: timer.summary,
      worklogType: timer.worklogType,
      checkpointWorkMs: getTotalWorkMs(timer),
      startedAt: timer.startedAt,
    });
  }

  // ─── Stop and log (shared across all stop paths) ────────────────────────────
  async function stopAndLog(): Promise<void> {
    if (!timer) return;
    const minutes = Math.max(1, Math.round(getTotalWorkMs(timer) / 60_000));
    const result = await window.vermilian.timerPostWorklog({
      issueId: timer.issueId,
      minutes,
      worklogType: timer.worklogType,
    });
    if (result.ok) {
      await window.vermilian.timerClearCheckpoint();
      clearTimer();
      showToast('positive', `Logged ${minutes} min to '${timer.issueReadableId}'.`, 4000);
    } else {
      showToast('negative', `Failed to log worklog: ${result.error ?? 'unknown'}`, 5000);
    }
  }

  // ─── Start timer ───────────────────────────────────────────────────────────
  function handleStartTimer(issueId: string, idReadable: string, summary: string) {
    if (timer) {
      if (timer.issueId === issueId) return; // already running for this task
      setConflict({
        currentSummary: timer.summary,
        newIssueId: issueId,
        newReadable: idReadable,
        newSummary: summary,
      });
      return;
    }
    startTimerStore(issueId, idReadable, summary, 'pomodoro', defaultWorklogType);
  }

  // ─── Quit dialog handlers ───────────────────────────────────────────────────
  async function handleStopAndQuit() {
    setQuitting(true);
    await stopAndLog();
    setQuitting(false);
    setQuitDialog(false);
    await window.vermilian.timerProceedQuit();
  }

  // ─── Standup config persist ─────────────────────────────────────────────────
  async function handleScopeChange(scope: StandupScope) {
    setStandupScope(scope);
    await window.vermilian.saveConfig({ standupScope: scope });
  }
  async function handleWindowChange(win: StandupWindow) {
    setStandupWindow(win);
    await window.vermilian.saveConfig({ standupWindow: win });
  }

  async function handleCrossBoardConfirm() {
    if (!crossBoardDrop) return;
    setCrossBoardMoving(true);
    const result = await window.vermilian.moveIssue({
      issueId: crossBoardDrop.issue.id,
      targetProjectId: crossBoardDrop.targetProjectId,
    });
    setCrossBoardMoving(false);
    if (result.ok) {
      showToast('positive', `Moved '${crossBoardDrop.issue.idReadable}' to '${crossBoardDrop.targetProjectName}'.`);
      // Invalidate the source board so the issue disappears
      if (activeProjectShortName) {
        void queryClient.invalidateQueries({ queryKey: ['youtrack', 'issues', activeProjectShortName] });
      }
    } else {
      showToast('negative', result.error ?? 'Move failed');
    }
    setCrossBoardDrop(null);
  }

  const isBreak = timer?.phase === 'short-break' || timer?.phase === 'long-break';

  return (
    <div className={styles.shell}>
      {/* Global top bar */}
      <div className={styles.topBar}>
        <span className={styles.topBarTagline}>
          Validate Estimates, Requirements, and Milestones; Identify, Log Issues, Assign Next steps
        </span>
        <SearchBar
          projectShortName={activeProjectShortName}
          projectName={activeProject?.name ?? null}
          onSelectIssue={(id) => setSelectedIssue(id)}
        />
        <div className={styles.topBarSpacer} />
        <span className={styles.version} title="Vermilian version">
          v{__APP_VERSION__}
        </span>
        <Tooltip
          content="Exit Vermilian"
        >
          <Button
            size="small"
            kind="tertiary"
            color="negative"
            onClick={() => window.vermilian.quitApp()}
          >
            Exit
          </Button>
        </Tooltip>
        <Tooltip
          content={
            hasClaudeKey
              ? 'Daily stand-up report'
              : 'Configure a Claude API key in Settings to generate stand-up reports.'
          }
        >
          <Button
            data-testid="standup-btn"
            size="small"
            kind="tertiary"
            leftIcon={Sun}
            onClick={() => setShowStandup(true)}
            disabled={!hasClaudeKey}
          >
            Stand-up
          </Button>
        </Tooltip>
      </div>

      {/* Break banner — shown when break phase is active */}
      {isBreak && (
        <BreakBanner pomodoro={pomodoro} onStopAndLog={stopAndLog} />
      )}

      <div className={styles.body}>
        <WorkspaceNav onOpenSettings={onOpenSettings} />

        <main className={styles.content}>
          {activeProject && activeProjectShortName ? (
            <ProjectBoard
              projectId={activeProjectId ?? ''}
              projectName={activeProject.name}
              projectShortName={activeProjectShortName}
              onSelectIssue={(id) => setSelectedIssue(id)}
              onNewTask={() => setShowCreateTask(true)}
              onAiCreate={() => setShowAiCreate(true)}
              onStartTimer={handleStartTimer}
              hasClaudeKey={hasClaudeKey}
              onCrossBoardDrop={(issue, targetProjectId, targetProjectName) => {
                if (targetProjectId === activeProjectId) return;
                setCrossBoardDrop({ issue, targetProjectId, targetProjectName });
              }}
            />
          ) : workspaceShortNames.length > 0 ? (
            <WorkspaceBoard
              workspaceName={workspaceName}
              projectShortNames={workspaceShortNames}
              youtrackLogin={config.data?.youtrackLogin ?? ''}
              onSelectIssue={(id) => setSelectedIssue(id)}
              onNewTask={() => setShowCreateTask(true)}
              onAiCreate={() => setShowAiCreate(true)}
              onStartTimer={handleStartTimer}
              hasClaudeKey={hasClaudeKey}
            />
          ) : (
            <div className={styles.placeholder}>
              <Text type="text1" style={{ color: 'var(--secondary-text-color, #444444)' }}>
                Select a project from the left rail to get started.
              </Text>
            </div>
          )}

          {selectedIssueId && (
            <TaskDetailPanel
              issueId={selectedIssueId}
              projectShortName={activeProjectShortName}
              onClose={() => setSelectedIssue(null)}
              onDeleted={() => setSelectedIssue(null)}
              onStartTimer={handleStartTimer}
              onStopAndLog={stopAndLog}
            />
          )}
        </main>
      </div>

      {/* Focus overlay — shown during work phase */}
      {timer?.phase === 'work' && (
        <FocusOverlay
          pomodoro={pomodoro}
          soundEnabled={soundEnabled}
          onStopAndLog={stopAndLog}
          onCheckpoint={handleCheckpoint}
        />
      )}

      {/* Modals */}
      {showCreateTask && projects.data && (
        <CreateTaskModal
          projects={projects.data}
          defaultProjectId={activeProjectId}
          onClose={() => setShowCreateTask(false)}
        />
      )}
      {showAiCreate && projects.data && (
        <AiCreateModal
          projects={projects.data}
          defaultProjectId={activeProjectId}
          onClose={() => setShowAiCreate(false)}
        />
      )}
      {showStandup && (
        <StandupModal
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          dailyNotesFolder={dailyNotesFolder}
          initialScope={standupScope}
          initialWindow={standupWindow}
          onClose={() => setShowStandup(false)}
          onScopeChange={handleScopeChange}
          onWindowChange={handleWindowChange}
        />
      )}

      {/* Timer conflict dialog */}
      {conflict && (
        <TimerConflictDialog
          info={conflict}
          onKeep={() => setConflict(null)}
          onStopAndStart={async () => {
            setConflict(null);
            await stopAndLog();
            startTimerStore(
              conflict.newIssueId,
              conflict.newReadable,
              conflict.newSummary,
              'pomodoro',
              defaultWorklogType,
            );
          }}
        />
      )}

      {/* Quit-protection dialog */}
      {quitDialog && timer && (
        <QuitDialog
          summary={timer.summary}
          elapsedMin={Math.round(getTotalWorkMs(timer) / 60_000)}
          onKeep={() => setQuitDialog(false)}
          onStopAndQuit={handleStopAndQuit}
          logging={quitting}
        />
      )}

      {/* Cross-board move confirmation */}
      {crossBoardDrop && (
        <div className={styles.dialogOverlay}>
          <div data-testid="cross-board-confirm-dialog" className={styles.dialog}>
            <Text type="text1" weight="bold">Move task to another project</Text>
            <Text type="text2">
              Move &apos;{crossBoardDrop.issue.idReadable}: {crossBoardDrop.issue.summary}&apos; to project &apos;{crossBoardDrop.targetProjectName}&apos;?
            </Text>
            <div className={styles.dialogActions}>
              <Button data-testid="cross-board-cancel-btn" kind="secondary" onClick={() => setCrossBoardDrop(null)} disabled={crossBoardMoving}>
                Cancel
              </Button>
              <Button onClick={() => { void handleCrossBoardConfirm(); }} loading={crossBoardMoving}>
                Move
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
