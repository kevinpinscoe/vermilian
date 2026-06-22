import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalContent, ModalHeader, Button, Text } from '@vibe/core';
import type { YouTrackProject } from '../../../shared/workspace';
import { useToastStore } from '../../stores/toast';
import { useQueryClient } from '@tanstack/react-query';
import { TaskForm, validateForm } from './TaskForm';
import type { FormState } from './TaskForm';
import styles from './AiCreateModal.module.css';

interface AiCreateModalProps {
  projects: YouTrackProject[];
  defaultProjectId: string | null;
  onClose: () => void;
}

type Step = 'input' | 'review';

function buildFormFromFields(
  fields: {
    summary: string;
    projectId: string | null;
    priority: string | null;
    status: string | null;
    category: string | null;
    dueDate: string | null;
    ticket: string | null;
    notes: string | null;
  },
  projects: YouTrackProject[],
  defaultProjectId: string | null,
): FormState {
  const fallbackProjectId =
    (defaultProjectId && projects.find((p) => p.id === defaultProjectId)
      ? defaultProjectId
      : null) ?? projects[0]?.id ?? '';

  return {
    summary: fields.summary,
    projectId: fields.projectId ?? fallbackProjectId,
    priority: fields.priority ?? 'Normal',
    status: fields.status ?? 'To do',
    category: fields.category ?? '',
    dueDate: fields.dueDate ?? '',
    ticket: fields.ticket ?? '',
    ticketLink: '',
    trackingLink: '',
    notes: fields.notes ?? '',
  };
}

export function AiCreateModal({ projects, defaultProjectId, onClose }: AiCreateModalProps) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const [step, setStep] = useState<Step>('input');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    summary: '',
    projectId: defaultProjectId ?? projects[0]?.id ?? '',
    priority: 'Normal',
    status: 'To do',
    category: '',
    dueDate: '',
    ticket: '',
    ticketLink: '',
    trackingLink: '',
    notes: '',
  });
  const [projectMatchError, setProjectMatchError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === 'input') textareaRef.current?.focus();
  }, [step]);

  async function handleGenerate() {
    if (!description.trim() || generating) return;

    setGenerating(true);
    setClarification(null);
    setInputError(null);

    const result = await window.vermilian.aiCreateTask({
      description: description.trim(),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    });

    setGenerating(false);

    if (!result.ok || !result.fields) {
      setInputError(result.error ?? 'An unexpected error occurred.');
      return;
    }

    const { fields } = result;

    if (fields.clarificationNeeded) {
      setClarification(fields.clarificationNeeded);
      return;
    }

    // Successful extraction — switch to review step
    setForm(buildFormFromFields(fields, projects, defaultProjectId));
    setProjectMatchError(fields.projectMatchError);
    setStep('review');
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const { summaryEmpty, ticketLinkInvalid, trackingLinkInvalid } = validateForm(form);
    if (summaryEmpty || ticketLinkInvalid || trackingLinkInvalid || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

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

    setSubmitting(false);

    if (!result.ok || !result.idReadable) {
      setSubmitError(result.error ?? 'Failed to create task.');
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

  const { summaryEmpty, ticketLinkInvalid, trackingLinkInvalid } = validateForm(form);
  const canCreate = !summaryEmpty && !ticketLinkInvalid && !trackingLinkInvalid && !submitting;

  // ─── Input step ─────────────────────────────────────────────────────────────

  if (step === 'input') {
    return (
      <Modal id="ai-create-modal" show onClose={onClose} size="medium">
        <ModalHeader title="AI create task" />
        <ModalContent>
          <div className={styles.inputStep}>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="ai-description">
                Describe your task
              </label>
              <Text type="text2" className={styles.subtitle}>
                Describe what needs to be done. Include any relevant details — priority,
                deadline, project, category, or related ticket numbers.
              </Text>
              <textarea
                ref={textareaRef}
                id="ai-description"
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                disabled={generating}
                placeholder="e.g. Fix the login page crash on Safari — critical, due Friday, related to JIRA-456"
              />
            </div>

            {clarification && (
              <div className={styles.banner} data-kind="info">
                <Text type="text2">{clarification}</Text>
              </div>
            )}

            {inputError && (
              <div className={styles.banner} data-kind="danger">
                <Text type="text2">{inputError}</Text>
              </div>
            )}

            <div className={styles.actions}>
              <Button kind="secondary" onClick={onClose} type="button" disabled={generating}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!description.trim() || generating}
                loading={generating}
              >
                {generating ? 'Generating…' : 'Generate'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    );
  }

  // ─── Review step ────────────────────────────────────────────────────────────

  return (
    <Modal id="ai-create-modal" show onClose={onClose} size="medium">
      <ModalHeader title="Review AI-generated task" />
      <ModalContent>
        <form onSubmit={handleSubmit} className={styles.reviewStep}>
          <div className={styles.banner} data-kind="info">
            <Text type="text2">AI-generated — please review before creating.</Text>
          </div>

          <div className={styles.fields}>
            <TaskForm
              form={form}
              onChange={setForm}
              projects={projects}
              loading={submitting}
              apiError={submitError}
              projectMatchError={projectMatchError}
            />
          </div>

          <div className={styles.reviewActions}>
            <button
              type="button"
              className={styles.redescribeLink}
              onClick={() => setStep('input')}
              disabled={submitting}
            >
              ← Re-describe
            </button>
            <div className={styles.actionsSpacer} />
            <Button kind="secondary" onClick={onClose} type="button" disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate} loading={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
