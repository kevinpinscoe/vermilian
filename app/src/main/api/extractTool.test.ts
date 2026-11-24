import { describe, expect, it } from 'vitest';
import { buildExtractTool, EXTRACT_TOOL_BASE } from './extractTool';
import type { CreateFieldOptions } from '../../shared/createFieldOptions';

type Props = Record<string, { enum?: unknown[]; description?: string }>;
const props = (t: ReturnType<typeof buildExtractTool>) => (t.input_schema as unknown as { properties: Props }).properties;

describe('buildExtractTool (VERM-115)', () => {
  it('fixes no value list when no project is known', () => {
    const p = props(buildExtractTool(null));
    expect(p.status.enum).toBeUndefined();
    expect(p.category.enum).toBeUndefined();
    expect(p.priority.enum).toBeUndefined(); // the old hard-coded priority list is gone
  });

  it("limits status, priority and category to the known project's values", () => {
    const allowed: CreateFieldOptions = {
      status: { present: true, values: ['Triage', 'Doing'], defaultValue: 'Triage', canBeEmpty: false },
      priority: { present: true, values: ['P1', 'P2'], defaultValue: null, canBeEmpty: true },
      category: { present: false, values: [], defaultValue: null, canBeEmpty: true },
    };
    const p = props(buildExtractTool(allowed));
    expect(p.status.enum).toEqual(['Triage', 'Doing', null]);
    expect(p.priority.enum).toEqual(['P1', 'P2', null]);
    expect(p.category.enum).toEqual([null]);
    // The shared base tool is never mutated.
    expect(props(EXTRACT_TOOL_BASE).status.enum).toBeUndefined();
  });
});
