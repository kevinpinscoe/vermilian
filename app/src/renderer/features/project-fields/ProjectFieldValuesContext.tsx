// Board-wide access to each project's select-field values (VERM-117), so a
// chip editor deep in a row can ask for its own issue's project without the
// values being threaded through every component in between.
//
// A board reads its projects with useProjectFieldValues and provides the
// result here. Outside a provider nothing is known, so editors offer only the
// current value — never a fixed list.

import React, { createContext, useContext } from 'react';
import type { ProjectFieldValues } from '../../../shared/projectFieldValues';
import type { ProjectFieldValuesState } from './useProjectFieldValues';

/** The project an issue belongs to: the short name in its readable id (VERM-12 → VERM). */
export function issueProject(issue: { idReadable: string }): string {
  const m = /^(.+)-\d+$/.exec(issue.idReadable);
  return m ? m[1] : '';
}

export interface ProjectFieldValuesLookup {
  valuesFor: (project: string) => ProjectFieldValues | undefined;
  errorFor: (project: string) => string | undefined;
  loading: boolean;
  retry: (project?: string) => void;
}

const EMPTY: ProjectFieldValuesLookup = {
  valuesFor: () => undefined,
  errorFor: () => undefined,
  loading: false,
  retry: () => {},
};

const Ctx = createContext<ProjectFieldValuesLookup>(EMPTY);

export function lookupFrom(state: ProjectFieldValuesState): ProjectFieldValuesLookup {
  return {
    valuesFor: (p) => state.byProject.get(p),
    errorFor: (p) => state.errors.get(p),
    loading: state.loading,
    retry: state.retry,
  };
}

export function ProjectFieldValuesProvider({ value, children }: { value: ProjectFieldValuesLookup; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectFieldValuesLookup(): ProjectFieldValuesLookup {
  return useContext(Ctx);
}

/** The projects these issues belong to, in first-seen order. */
export function issueProjects(issues: ReadonlyArray<{ idReadable: string }>): string[] {
  const out: string[] = [];
  for (const i of issues) {
    const p = issueProject(i);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Each of these issues' projects' values, in first-seen order (unknown ones skipped). */
export function valuesForIssues(lookup: ProjectFieldValuesLookup, issues: ReadonlyArray<{ idReadable: string }>): ProjectFieldValues[] {
  return issueProjects(issues).map((p) => lookup.valuesFor(p)).filter((v): v is ProjectFieldValues => Boolean(v));
}
