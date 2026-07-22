export const STATUS_COLORS: Record<string, string> = {
  'To do': '#C4C4C4',
  'In Progress': '#579BFC',
  'Working on it': '#FDBC64',
  'Done': '#00C875',
  'BLOCKED': '#E2445C',
  'Waiting for IT': '#A25DDC',
  'Waiting for approval': '#FDBC64',
  'Waiting for customer': '#FFCB00',
  'Waiting on external resource': '#9D99B9',
};

export const PRIORITY_COLORS: Record<string, string> = {
  'Show-stopper': '#E2445C',
  Critical: '#E2445C',
  Major: '#FDBC64',
  Normal: '#579BFC',
  Minor: '#C4C4C4',
};

export const CATEGORY_COLORS: Record<string, string> = {
  PROJECT: '#579BFC',
  OPS: '#FDAB3D',
  COMPANY: '#7E3FF2',
  SERVICE: '#00C875',
  PRODUCTIVITY: '#FFCB00',
  INBOX: '#A25DDC',
  ADMIN: '#808080',
  RELEASE: '#66CCFF',
  FINOPS: '#037F4C',
  SECURITY: '#E2445C',
  INGEST: '#FF642E',
  HACKATHON: '#FF158A',
  Playbook: '#BB3354',
};

export function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#323338' : '#ffffff';
}
