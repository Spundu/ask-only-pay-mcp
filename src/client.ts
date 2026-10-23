// The MCP server's handle to the approver. It can ask and read, nothing else (SPEC.md §2.1): there is no
// approve, cancel or execute method here, and the approver has no endpoint for one either.

import { z } from 'zod';
import { APPROVAL_ID, STATES, hasCardNumber, type AccountFields, type PayFields } from './rules.js';

/** One HTTP answer, as raw text: the client decides what it means. */
export interface Reply {
  status: number;
  body: string;
}

/** How the client reaches the approver. The real one is mTLS (src/transport.ts); tests fake it. */
export interface Transport {
  post(path: string, body: unknown): Promise<Reply>;
  get(path: string): Promise<Reply>;
}

/** The codes of SPEC.md §4 that come from talking to the approver. */
export type ClientErrorCode =
  | 'APPROVER_UNREACHABLE'
  | 'APPROVER_REFUSED'
  | 'APPROVER_RESPONSE_REJECTED'
  | 'NOT_FOUND'
  | 'TOO_MANY_PENDING';

export class ClientError extends Error {
  override name = 'ClientError';
  constructor(readonly code: ClientErrorCode) {
    super(code);
  }
}

/** Strict: a field the approver should never send (a recap, a card, a token) fails the parse (SPEC.md §2.2). */
const AckSchema = z.strictObject({
  approval_id: z.string().regex(APPROVAL_ID),
  state: z.literal('pending'),
  expires_at: z.number().int().nonnegative(),
});

// Short codes only: at most 64 letters, digits, - and _, and never a card number. `.nullish()`, not
// `.optional()`: a server may write an empty optional as an explicit null, and `.optional()` refuses null.
const shortCode = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .refine((s) => !hasCardNumber(s))
  .nullish()
  .transform((v) => v ?? undefined);
const ResultSchema = z.strictObject({
  approval_id: z.string().regex(APPROVAL_ID),
  state: z.enum(STATES),
  ref: shortCode,
  error_code: shortCode,
});

export type Ack = z.infer<typeof AckSchema>;
export type Result = z.infer<typeof ResultSchema>;

export class ApproverClient {
  constructor(private readonly transport: Transport) {}

  async requestPay(fields: PayFields, requestId: string): Promise<Ack> {
    return parse(AckSchema, 201, false, await this.send(() => this.transport.post('/v1/pay', { ...fields, request_id: requestId })));
  }

  async requestAccountCreate(fields: AccountFields, requestId: string): Promise<Ack> {
    return parse(AckSchema, 201, false, await this.send(() => this.transport.post('/v1/account/create', { ...fields, request_id: requestId })));
  }

  async status(approvalId: string): Promise<Result> {
    const result = parse(ResultSchema, 200, true, await this.send(() => this.transport.get(`/v1/result/${encodeURIComponent(approvalId)}`)));
    // An answer about another ask is not an answer.
    if (result.approval_id !== approvalId) throw new ClientError('APPROVER_RESPONSE_REJECTED');
    return result;
  }

  private async send(call: () => Promise<Reply>): Promise<Reply> {
    try {
      return await call();
    } catch {
      throw new ClientError('APPROVER_UNREACHABLE');
    }
  }
}

/** `lookup`: a 404 means "no such ask" (status). On an ask, a 404 is a misconfigured approver URL. */
function parse<S extends z.ZodType>(schema: S, expected: number, lookup: boolean, reply: Reply): z.output<S> {
  if (reply.status === 404 && lookup) throw new ClientError('NOT_FOUND');
  if (reply.status === 429) throw new ClientError('TOO_MANY_PENDING');
  // The approver's own error text is never passed on (SPEC.md §2.4).
  if (reply.status !== expected) throw new ClientError('APPROVER_REFUSED');
  let json: unknown;
  try {
    json = JSON.parse(reply.body);
  } catch {
    throw new ClientError('APPROVER_RESPONSE_REJECTED');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ClientError('APPROVER_RESPONSE_REJECTED');
  return parsed.data;
}
