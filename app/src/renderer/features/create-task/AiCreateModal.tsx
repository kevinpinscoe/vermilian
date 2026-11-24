import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalContent, ModalHeader, Button, Text } from '@vibe/core';
import type { YouTrackProject } from '../../../shared/workspace';
import { useToastStore } from '../../stores/toast';
import { useQueryClient } from '@tanstack/react-query';
import { TaskForm, validateForm } from './TaskForm';
import type { FormState } from './TaskForm';
import { useWorkspaceAi } from '../workspace-nav/useWorkspaceAi';
import { useTaskFormOptions } from './useTaskFormOptions';
import { CREATE_FIELD_KEYS, CREATE_FIELD_NAMES, type CreateFieldKey } from '../../../shared/createFieldOptions';
import { clearedFlag, type FieldFlags } from './formOptions';
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
  // No guess-fallback to projects[0] — an unverified default risks silently
  // landing on an unconfigured/demo project whose Status or Category bundle
  // doesn't match ours. Require an explicit, verified active project.
  const fallbackProjectId =
    defaultProjectId && projects.find((p) => p.id === defaultProjectId) ? defaultProjectId : '';

  // No assumed defaults (VERM-115): a field Claude left empty takes the
  // project's own default once its options are read, or stays empty.
  return {
    summary: fields.summary,
    projectId: fields.projectId ?? fallbackProjectId,
    priority: fields.priority ?? '',
    status: fields.status ?? '',
    category: fields.category ?? '',
    dueDate: fields.dueDate ?? '',
    ticket: fields.ticket ?? '',
    ticketLink: '',
    relatedLink: '',
    notes: fields.notes ?? '',
    repoUrl: '',
  };
}

export function AiCreateModal({ projects, defaultProjectId, onClose }: AiCreateModalProps) {
  const ai = useWorkspaceAi();
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const [step, setStep] = useState<Step>('input');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    summary: '',
    projectId:
      defaultProjectId && projects.find((p) => p.id === defaultProjectId) ? defaultProjectId : '',
    priority: '',
    status: '',
    category: '',
    dueDate: '',
    ticket: '',
    ticketLink: '',
    relatedLink: '',
    notes: '',
    repoUrl: '',
  });
  const [projectMatchError, setProjectMatchError] = useState(false);
  const [optionsReady, setOptionsReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitErrorRefresh, setSubmitErrorRefresh] = useState(false);
  // What the AI chose and what was cleared, for the review form (VERM-115).
  const [review, setReview] = useState<{ key: number; touched: CreateFieldKey[]; flags: FieldFlags }>({ key: 0, touched: [], flags: {} });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === 'input') textareaRef.current?.focus();
  }, [step]);

  async function handleGenerate() {
    if (!description.trim() || generating) return;

    setGenerating(true);
    setClarification(null);
    setInputError(null);

    const askedFrom = ai.workspaceId;
    const result = await window.vermilian.aiCreateTask({
      description: description.trim(),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      // The project already chosen, if any, so Claude is given its values.
      projectId: form.projectId || undefined,
      workspaceId: askedFrom,
    });

    setGenerating(false);
    // Asked from a workspace the user has since left: drop the answer (VERM-47).
    if (!ai.isStillActive(askedFrom)) return;

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
    const next = buildFormFromFields(fields, projects, defaultProjectId);
    const flags: FieldFlags = {};
    for (const c of fields.clearedSuggestions ?? []) {
      const key = CREATE_FIELD_KEYS.find((k) => CREATE_FIELD_NAMES[k] === c.field);
      if (key) flags[key] = clearedFlag(key, c.value, true);
    }
    setForm(next);
    // A value the AI gave counts as chosen, and so does one cleared as
    // invalid (it stays empty and flagged); one it left empty takes the default.
    setReview((r) => ({ key: r.key + 1, touched: CREATE_FIELD_KEYS.filter((k) => next[k] !== '' || k in flags), flags }));
    setProjectMatchError(fields.projectMatchError);
    setSubmitError(null);
    setSubmitErrorRefresh(false);
    setStep('review');
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const { summaryEmpty, projectEmpty, ticketLinkInvalid, relatedLinkInvalid, repoUrlInvalid } =
      validateForm(form);
    if (summaryEmpty || projectEmpty || ticketLinkInvalid || relatedLinkInvalid || repoUrlInvalid || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitErrorRefresh(false);

    const dueDate = form.dueDate ? new Date(form.dueDate).getTime() : null;

    const result = await window.vermilian.createIssue({
      workspaceId: ai.workspaceId,
      projectId: form.projectId,
      summary: form.summary.trim(),
      status: form.status || null,
      priority: form.priority || null,
      category: form.category || null,
      dueDate,
      ticket: form.ticket.trim() || null,
      ticketLink: form.ticketLink.trim() || null,
      relatedLink: form.relatedLink.trim() || null,
      notes: form.notes.trim() || null,
      repoUrl: form.repoUrl.trim() || null,
    });

    setSubmitting(false);

    if (!result.ok || !result.idReadable) {
      setSubmitError(result.error ?? 'Failed to create task.');
      setSubmitErrorRefresh(Boolean(result.refreshOptions));
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

  const { summaryEmpty, projectEmpty, ticketLinkInvalid, relatedLinkInvalid, repoUrlInvalid } =
    validateForm(form);
  const canCreate =
    !summaryEmpty && !projectEmpty && !ticketLinkInvalid && !relatedLinkInvalid && !repoUrlInvalid && !submitting && optionsReady;

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
                data-testid="ai-generate-btn"
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
            <ReviewForm
              key={review.key}
              workspaceId={ai.workspaceId}
              form={form}
              setForm={setForm}
              projects={projects}
              touched={review.touched}
              flags={review.flags}
              submitting={submitting}
              submitError={submitError}
              submitErrorRefresh={submitErrorRefresh}
              projectMatchError={projectMatchError}
              onReadyChange={setOptionsReady}
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
            <Button data-testid="ai-create-submit" type="submit" disabled={!canCreate} loading={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}

// The review step's form. Remounted for each AI answer (its `key`), so the
// options hook starts from that answer's chosen and cleared fields.
function ReviewForm({
  workspaceId, form, setForm, projects, touched, flags, submitting, submitError, submitErrorRefresh, projectMatchError, onReadyChange,
}: {
  workspaceId: string;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  projects: YouTrackProject[];
  touched: CreateFieldKey[];
  flags: FieldFlags;
  submitting: boolean;
  submitError: string | null;
  submitErrorRefresh: boolean;
  projectMatchError: boolean;
  onReadyChange: (ready: boolean) => void;
}) {
  const fieldOptions = useTaskFormOptions(workspaceId, projects, form, setForm, {
    touched,
    fromAi: touched,
    flags,
  });
  useEffect(() => { onReadyChange(fieldOptions.ready); }, [fieldOptions.ready, onReadyChange]);
  return (
    <TaskForm
      form={form}
      onChange={setForm}
      projects={projects}
      fieldOptions={fieldOptions}
      loading={submitting}
      apiError={submitError}
      apiErrorRefresh={submitErrorRefresh}
      projectMatchError={projectMatchError}
    />
  );
}
