// Shared plumbing for the Claude calls in claude.ts: the SDK client factory (with a
// test hook), output budgets, user-facing failure messages, and the tool-call
// helper. Kept out of claude.ts because claudeClient.ts requires claude.ts and
// the e2e fake (fakeClaude.ts) to export the same surface.

import Anthropic from '@anthropic-ai/sdk';

// ─── SDK client ─────────────────────────────────────────────────────────────
// Every call builds its client through makeClient so unit tests can swap in one
// with a stub fetch (no network, no key). Production never changes it.

export type ClientFactory = (apiKey: string) => Anthropic;
const defaultClientFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey });
let clientFactory: ClientFactory = defaultClientFactory;

export function makeClient(apiKey: string): Anthropic {
  return clientFactory(apiKey);
}

/** Test hook: replace the SDK client factory. Returns a function that restores the default. */
export function setClaudeClientFactoryForTests(factory: ClientFactory): () => void {
  clientFactory = factory;
  return () => {
    clientFactory = defaultClientFactory;
  };
}

// ─── Output budgets ─────────────────────────────────────────────────────────
// max_tokens is a ceiling, not a cost: a short reply bills only what it uses.
// It has to leave room for thinking, which newer models (Claude Opus 5.5 and
// later) cannot turn off and which counts toward max_tokens — the old 1024 could
// run out before the tool call or the report text was written (VERM-113).
export const EXTRACT_MAX_TOKENS = 8192;
export const RECOMMENDATION_MAX_TOKENS = 8192;
export const STANDUP_MAX_TOKENS = 8192;

export const CUT_OFF_MESSAGE =
  'The model ran out of room before it finished. Please try again; if it keeps happening, choose a different model in Settings → AI.';
export const REFUSED_MESSAGE =
  'The model declined this request. Try rephrasing it, or choose a different model in Settings → AI.';
export const NO_TOOL_MESSAGE = 'Model did not return structured output — please try again.';

// ─── Tool calls ─────────────────────────────────────────────────────────────
// Claude Opus 5.5, Claude Sonnet 5.5 and Claude Fable/Mythos 5.1 and later reject
// forced tool use (tool_choice "any" or "tool") with a 400. Every call here uses
// tool_choice "auto" with the instruction to call the tool in the prompt, which
// works on every model, so no model-name check is needed on the free-text model
// setting. "auto" does not guarantee a call, so one retry covers a reply that
// answered in text. The callers already validate the tool input themselves.
//
// strict tools / structured outputs were not used: claude-sonnet-4-6, the default
// recommendation and stand-up model, does not support them.

// Exactly one of input or failure is non-null. Kept flat, like TestClaudeResult,
// so callers check one field instead of narrowing a union.
export interface ToolCallOutcome {
  input: Record<string, unknown> | null;
  failure: 'no-tool' | 'cut-off' | 'refused' | null;
}

type ToolCallParams = Omit<Anthropic.MessageCreateParamsNonStreaming, 'tools' | 'tool_choice'> & {
  tool: Anthropic.Tool;
};

export async function callTool(client: Anthropic, params: ToolCallParams): Promise<ToolCallOutcome> {
  const { tool, ...rest } = params;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      ...rest,
      tools: [tool],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    });
    // A cut-off reply can hold a half-written tool call; never parse it.
    if (response.stop_reason === 'max_tokens') return { input: null, failure: 'cut-off' };
    if (response.stop_reason === 'refusal') return { input: null, failure: 'refused' };
    const block = response.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (block && block.type === 'tool_use') {
      return { input: block.input as Record<string, unknown>, failure: null };
    }
  }
  return { input: null, failure: 'no-tool' };
}

export function toolFailureMessage(failure: ToolCallOutcome['failure']): string {
  if (failure === 'cut-off') return CUT_OFF_MESSAGE;
  if (failure === 'refused') return REFUSED_MESSAGE;
  return NO_TOOL_MESSAGE;
}
