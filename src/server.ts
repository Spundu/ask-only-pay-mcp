// The MCP server: one tool, `request`. The same factory serves stdio (src/index.ts) and the in-process tests.

import { createRequire } from 'node:module';
import { McpServer, type CallToolResult, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { ApproverClient } from './client.js';
import { DESCRIPTION, INPUT_JSON_SCHEMA, handleRequest } from './tool.js';

export const NAME = 'ask-only-pay-mcp';
export const VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/** An ask changes nothing until a person approves it, and every ask is new (SPEC.md §3). */
const ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

/**
 * The input schema as the SDK takes it: it advertises INPUT_JSON_SCHEMA and lets every argument object
 * through to the tool's own strict parse. Were the SDK to validate, a bad call would come back as the SDK's
 * own message, which quotes the arguments, instead of the code INVALID_ARGUMENTS (SPEC.md §2.4).
 */
const inputSchema: StandardSchemaWithJSON<Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: NAME,
    validate: (value: unknown) => ({ value: value as Record<string, unknown> }),
    jsonSchema: { input: () => INPUT_JSON_SCHEMA, output: () => INPUT_JSON_SCHEMA },
  },
};

export function createServer(client: ApproverClient): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { capabilities: { tools: { listChanged: false } } });
  server.registerTool(
    'request',
    { title: 'Ask a person to approve a payment or signup', description: DESCRIPTION, inputSchema, annotations: ANNOTATIONS },
    async (args): Promise<CallToolResult> => {
      const outcome = await handleRequest(client, args);
      const value = outcome.ok ? outcome.value : { error: outcome.code };
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(outcome.ok ? {} : { isError: true }) };
    },
  );
  return server;
}
