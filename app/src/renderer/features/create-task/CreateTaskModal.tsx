import React, { useState } from 'react';
import { Modal, ModalContent, ModalHeader, Button } from '@vibe/core';
import type { YouTrackProject } from '../../../shared/workspace';
import { useToastStore } from '../../stores/toast';
import { useQueryClient } from '@tanstack/react-query';
import { TaskForm, makeDefaultFormState, validateForm } from './TaskForm';
import type { FormState } from './TaskForm';
import styles from './CreateTaskModal.module.css';

interface CreateTaskModalProps {
  projects: YouTrackProject[];
  defaultProjectId: string | null;
  onClose: () => void;
}

export function CreateTaskModal({ projects, defaultProjectId, onClose }: CreateTaskModalProps) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    makeDefaultFormState(projects, defaultProjectId),
  );

  const { summaryEmpty, ticketLinkInvalid, trackingLinkInvalid } = validateForm(form);
  const canCreate = !summaryEmpty && !ticketLinkInvalid && !trackingLinkInvalid && !loading;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canCreate) return;

    setLoading(true);
    setApiError(null);

    const dueDate = form.dueDate ? new Date(form.dueDate).getTime() : null;

    const result = await window.vermilian.createIssue({
      projectId: form.projectId,
      summary: form.summary.trim(),
      status: form.status || null,
      priority: form.priority || null,
      category: form.category || null,
      dueDate,
      ticket: form.ticket.trim() || null,
      ticketLink: form.ticketLink.trim() || null,
      trackingLink: form.trackingLink.trim() || null,
      notes: form.notes.trim() || null,
    });

    setLoading(false);

    if (!result.ok || !result.idReadable) {
      setApiError(result.error ?? 'Failed to create task.');
      return;
    }

    const project = projects.find((p) => p.id === form.projectId);
    if (project) {
      void queryClient.invalidateQueries({
        queryKey: ['youtrack', 'issues', project.shortName],
      });
    }

    showToast('positive', `Task created — ${result.idReadable}`, 3000);
    onClose();
  }

  return (
    <Modal id="create-task-modal" show onClose={onClose} size="medium">
      <ModalHeader title="Create task" />
      <ModalContent>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.fields}>
            <TaskForm
              form={form}
              onChange={setForm}
              projects={projects}
              loading={loading}
              apiError={apiError}
              autoFocusSummary
            />
          </div>
          <div className={styles.actions}>
            <Button kind="secondary" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button type="submit" data-testid="task-create-btn" disabled={!canCreate} loading={loading}>
              {loading ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
