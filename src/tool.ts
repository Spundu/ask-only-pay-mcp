// The one tool, `request` (SPEC.md §3). The agent supplies the intent; this server mints the request id
// and passes back only an id and a state. Every failure is a code from SPEC.md §4, nothing more.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApproverClient, ClientError } from './client.js';
import { APPROVAL_ID, accountFields, payFields } from './rules.js';

export const VERBS = ['pay', 'account_create', 'status'] as const;

// Strict, so a `request_id` (or anything else the agent adds) is refused, not ignored (SPEC.md §2.3).
const RequestArgs = z.discriminatedUnion('verb', [
  z.strictObject({ verb: z.literal('pay'), ...payFields }),
  z.strictObject({ verb: z.literal('account_create'), ...accountFields }),
  z.strictObject({ verb: z.literal('status'), approval_id: z.string().regex(APPROVAL_ID) }),
]);

export type ErrorCode = ClientError['code'] | 'INVALID_ARGUMENTS' | 'INTERNAL_ERROR';
export type Outcome = { ok: true; value: Record<string, unknown> } | { ok: false; code: ErrorCode };

export async function handleRequest(client: ApproverClient, raw: unknown, newRequestId: () => string = randomUUID): Promise<Outcome> {
  const args = RequestArgs.safeParse(raw);
  // A malformed money request is refused, never guessed at.
  if (!args.success) return { ok: false, code: 'INVALID_ARGUMENTS' };
  try {
    const a = args.data;
    switch (a.verb) {
      case 'pay': {
        const { verb: _verb, ...fields } = a;
        return { ok: true, value: await client.requestPay(fields, newRequestId()) };
      }
      case 'account_create': {
        const { verb: _verb, ...fields } = a;
        return { ok: true, value: await client.requestAccountCreate(fields, newRequestId()) };
      }
      case 'status':
        return { ok: true, value: dropUndefined(await client.status(a.approval_id)) };
    }
  } catch (err) {
    return { ok: false, code: err instanceof ClientError ? err.code : 'INTERNAL_ERROR' };
  }
}

function dropUndefined(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/** Written for the model: the pause has to read as the normal path, or an agent in a hurry looks for a way round it. */
export const DESCRIPTION =
  'Ask a person to approve a payment or an account signup. This is the only way to pay for anything or ' +
  'create an account: never fill in a checkout or a signup form yourself, and never handle card numbers, ' +
  'passwords or one-time codes. You are ASKING, not doing. The approver shows the person its own recap of ' +
  'exactly what you asked for; you get back an approval_id and an expiry. Call again with verb "status" ' +
  'to read the decision. "pending" and "denied" are normal answers, not errors to work around.';

const handle = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' } as const;
const httpsUrl = { type: 'string', format: 'uri', maxLength: 2000 } as const;

/** The JSON Schema the model sees. The tool's own strict parse (above) decides what is accepted. */
export const INPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verb: { type: 'string', enum: [...VERBS], description: 'pay | account_create | status' },
    merchant: { type: 'string', maxLength: 120, description: 'pay: who is paid, as the person will read it' },
    amount: { type: 'string', pattern: '^(0|[1-9][0-9]{0,8})(\\.[0-9]{1,2})?$', description: 'pay: a decimal string such as "19.00", never a number' },
    currency: { type: 'string', pattern: '^[A-Z]{3}$', description: 'pay: ISO 4217 code, such as "EUR"' },
    card_handle: { ...handle, description: 'pay: the name of a card, such as "card-2". Never a card number.' },
    checkout_url: { ...httpsUrl, description: 'pay: the exact https checkout URL the payment is for' },
    provider_url: { ...httpsUrl, description: 'account_create: the https signup URL the account is for' },
    identity_handle: { ...handle, description: 'account_create: which identity to sign up with, such as "work". Never an email address. Default "primary".' },
    reason: { type: 'string', maxLength: 500, description: 'pay, account_create: why, in one sentence. Shown to the person, marked as written by you.' },
    approval_id: { type: 'string', pattern: '^[A-Z2-7]{10}$', description: 'status: the approval_id an earlier ask returned' },
  },
  required: ['verb'],
} as const;
