// Fake YouTrack seeding for the per-project field value specs (VERM-117).
//   - TEST: Status where "Consider" is open work, Done and Wont do resolve;
//     Affected host [FLDW, core] plus an archived "retired-vm".
//   - TST2: Status where "Consider" and "Fixed" resolve; its own Priority
//     [P1, P2, P3] (so a fixture issue's "Normal" is outside it); Affected
//     host [web1, mail1].
export const PROJECT_FIELD_ENV: Record<string, string> = {
  VERMILIAN_E2E_YT_CREATE_FIELDS: JSON.stringify({
    TEST: { 'Affected host': { values: ['FLDW', 'core'], archived: ['retired-vm'] } },
    TST2: {
      Priority: { values: ['P1', 'P2', 'P3'], default: null },
      'Affected host': { values: ['web1', 'mail1'] },
    },
  }),
  VERMILIAN_E2E_YT_STATUS_BUNDLES: JSON.stringify({
    TEST: [
      { name: 'To do' }, { name: 'In Progress' }, { name: 'Consider' },
      { name: 'Done', isResolved: true }, { name: 'Wont do', isResolved: true },
    ],
    TST2: [
      { name: 'To do' }, { name: 'In Progress' },
      { name: 'Consider', isResolved: true }, { name: 'Fixed', isResolved: true },
    ],
  }),
  // TST2's Priority order for the Desk's ranking (VERM-92 reader).
  VERMILIAN_E2E_YT_PRIORITY_BUNDLES: JSON.stringify({ TST2: ['P1', 'P2', 'P3'] }),
};
