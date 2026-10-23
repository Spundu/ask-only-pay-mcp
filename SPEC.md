# ask-only-pay-mcp — specification

This file is the contract. Codes, field names and environment variables here are public API. To change
behaviour, change this file first, then the code and its tests in the same commit.

## 1. The idea

An AI agent sometimes needs to pay for something or sign up for an account. Letting it type a card number
or a password into a web page is how money and accounts get lost. This project splits the job in two:

- **The MCP server** (`ask-only-pay-mcp`) gives the agent one tool, `request`. The agent can **ask** for a
  payment or an account signup, and read the state of an earlier ask. Nothing else.
- **The approver** (`ask-only-pay-approver`) is a separate process. It stores each ask, shows a person a
  recap **it renders itself**, and records that person's yes or no. It is the only place an ask can be
  approved.

The two talk over HTTPS with mutual TLS (mTLS): each side proves who it is with a certificate.

The approver in this repo is a **reference**: it approves or denies, and on approval it records a fake
reference (`demo-…`). It never moves money and never creates accounts. A real deployment puts a real
payment step behind the same three endpoints.

## 2. What makes the agent's side powerless

Each rule is a property of the code, not a promise.

1. **Ask only.** The client in `src/client.ts` has three methods: `requestPay`, `requestAccountCreate`,
   `status`. There is no approve, cancel or execute method, and the approver has no HTTP endpoint for them
   either: approval happens only on the approver's own console.
2. **Nothing secret comes back.** Every approver response is parsed against a strict schema. An extra field
   (a recap, a card number, a token) makes the parse fail, and the agent gets the code
   `APPROVER_RESPONSE_REJECTED` instead of the data.
3. **The server picks the request id.** The agent never supplies one, so it cannot replay or collide with an
   earlier ask. A network retry makes a second pending ask, which the person sees and denies: the safer of
   the two failures.
4. **Errors are codes.** A tool failure returns `{"error": CODE}` with one of the codes in §4. Never a
   message, URL or response body, which could carry something the agent should not see.
5. **No secrets in arguments.** A card is named by a handle (`card-2`), an identity by a handle (`work`),
   never by a number or an address. Handles match `^[a-z0-9][a-z0-9_-]{0,31}$`, so an email address cannot
   pass. Every field (handles, `merchant`, `reason`, URLs) is refused if it holds a card number: 13 to 19
   digits in a row that pass the Luhn checksum, also inside a longer run of digits, with up to two spaces,
   dots, dashes or underscores between digits, after full-width digits are read as digits and (for any
   field) %-escapes are decoded. A random 13-digit window passes Luhn one time in ten, so a long digit run
   is refused almost always; 12 digits or fewer are always allowed. This catches a card pasted by mistake.
   It is no defence against an agent set on hiding one (it could spell the digits out): the real defence is
   that the agent never sees a card at all.
6. **Fails closed at start.** Missing, unreadable or invalid configuration stops the server before it serves
   anything (exit code 2), with the reason on stderr. Invalid means: a file that is not PEM, a key that does
   not belong to its certificate, or a CA file that is not a CA certificate. A path or a file's content is
   never printed.

## 3. The tool `request`

One tool. Arguments are an object with `verb` and the fields for that verb. Unknown fields are refused.

| verb | fields | returns |
|---|---|---|
| `pay` | `merchant` (1–120 chars), `amount` (decimal string, `^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$`, above 0), `currency` (`^[A-Z]{3}$`), `card_handle` (handle), `checkout_url` (an `https:` URL, at most 2,000 chars), `reason` (optional, at most 500 chars) | `{approval_id, state: "pending", expires_at}` |
| `account_create` | `provider_url` (an `https:` URL, at most 2,000 chars), `identity_handle` (optional handle, default `primary`), `reason` (optional, at most 500 chars) | same as `pay` |
| `status` | `approval_id` (`^[A-Z2-7]{10}$`) | `{approval_id, state, ref?, error_code?}` |

- URLs must be `https:` with a host and no user name or password.
- `expires_at` is Unix time in seconds. A pending ask expires 10 minutes after it was made.
- `state` is one of `pending`, `approved`, `denied`, `expired`.
- `ref` is set only when `state` is `approved` (the reference approver writes `demo-` and 8 hex digits).
- `reason` is stored with the ask and **shown** on the approver's recap, marked as written by the agent.
- Annotations: `readOnlyHint: false`, `destructiveHint: false` (an ask changes nothing until a person
  approves it), `idempotentHint: false` (every ask is new), `openWorldHint: true`.

Results come as JSON text and as `structuredContent`.

## 4. Error codes

| code | when |
|---|---|
| `INVALID_ARGUMENTS` | the arguments fail §3 |
| `APPROVER_UNREACHABLE` | no connection, TLS failure, no complete answer within 10 s (for the whole call, not between bytes), or an answer over 64 KiB |
| `APPROVER_REFUSED` | the approver answered 4xx or 5xx, or 404 to an ask (its own `error` code is not passed on) |
| `APPROVER_RESPONSE_REJECTED` | the answer was not JSON, failed the strict schema, or was about another ask |
| `NOT_FOUND` | `status` for an id the approver does not know |
| `TOO_MANY_PENDING` | the approver already holds 50 pending asks |
| `INTERNAL_ERROR` | a bug in this server |

`APPROVER_REFUSED` covers a replayed request id (409), which cannot happen while this server mints the ids.

## 5. Configuration (environment only, never on the command line)

MCP server:

| variable | |
|---|---|
| `ASK_ONLY_PAY_URL` | required. The approver's base URL, `https://host:port`. |
| `ASK_ONLY_PAY_CLIENT_CERT`, `ASK_ONLY_PAY_CLIENT_KEY` | required. PEM files: this client's certificate and key (`client.pem`, `client.key`). |
| `ASK_ONLY_PAY_CA` | required. The CA that signed the approver's certificate (`approver-ca.pem`). |
| `ASK_ONLY_PAY_SERVERNAME` | optional. The name to expect in the approver's certificate. Default: the URL's host. |

There is no switch to turn mTLS off. Tests use real certificates.

Approver:

| variable | |
|---|---|
| `ASK_ONLY_PAY_APPROVER_CERT`, `ASK_ONLY_PAY_APPROVER_KEY` | required. The approver's certificate and key (`approver.pem`, `approver.key`). |
| `ASK_ONLY_PAY_APPROVER_CA` | required. The CA whose certificates may connect (`client-ca.pem`). |
| `ASK_ONLY_PAY_APPROVER_PORT` | optional, default 8443; 0 picks a free port. |
| `ASK_ONLY_PAY_APPROVER_HOST` | optional, default 127.0.0.1. |

Either program, missing a variable or unable to read a file, prints the reason and exits 2.

`npm run certs -- DIR` (needs `openssl`) writes two separate CAs into DIR, so the client's certificate can
never pass as the approver's: one signs the approver's certificate (for `localhost` and `127.0.0.1`), the
other the client's. Both CA keys are deleted once the certificates are signed, so nothing can mint another.
The certificates last 30 days.

## 6. The approver's HTTP API (mTLS required)

| method and path | body | answer |
|---|---|---|
| `POST /v1/pay` | the `pay` fields plus `request_id` | 201 `{approval_id, state, expires_at}` |
| `POST /v1/account/create` | the `account_create` fields plus `request_id` | 201, same |
| `GET /v1/result/{approval_id}` | | 200 `{approval_id, state, ref?, error_code?}` |

Errors: 400 `{"error":"invalid_request"}`, 404 `{"error":"not_found"}`, 409 `{"error":"duplicate_request"}`
(a `request_id` seen before), 413 for a body over 16 KiB, 429 `{"error":"too_many_pending"}`. The approver
validates every field by the same rules as §3 itself: it never trusts the MCP server's checks.

Limits: a body declared or found to be over 16 KiB gets 413 at once and the connection is closed (the rest is
never read); a TLS handshake must finish within 5 s; at most 64 connections at once. The approver keeps the
1,000 most recent asks (pending asks are never dropped) and the request ids of those it keeps: a request id
is refused while its ask is kept.

## 7. The approver's console

A new ask prints a recap on the approver's terminal, built from the stored ask only:

```
[ask K7Q2M4XZ3A] PAY 19.00 EUR
  to:        Example Shop
  card:      card-2
  site:      shop.example
  checkout:  https://shop.example/checkout/123
  reason:    (from the agent, unchecked) renew the domain
  expires:   in 10 min
  approve K7Q2M4XZ3A   or   deny K7Q2M4XZ3A
```

The person types `approve ID` or `deny ID` (any case). `list` shows pending asks. A decision is answered
with what was decided, from the stored ask: `K7Q2M4XZ3A: approved: PAY 19.00 EUR at shop.example`.

Rules for the recap, so text from the agent cannot forge or blur it:

- Every line is at most 76 columns, so the terminal never wraps one by itself. A longer value is cut by the
  approver, and each further line starts with `           > `. So only the approver's own lines start with
  `[ask` or a label: a fake recap inside a reason or a merchant name cannot begin a line.
- Runs of spaces become one. Shown as `\u{…}` escapes: control characters, format characters (bidi
  overrides, zero-width and tag characters), line and paragraph separators, private-use and unassigned code
  points, variation selectors, blank fillers (Hangul, braille) and every space but the plain one.
- URLs are shown as the browser resolves them; the `site` line shows the host in punycode, so a look-alike
  domain (`shop.exаmple` with a Cyrillic а) shows as `xn--…`.
- An approval is final: there is no way to change an ask after it was made, so what the person approved is
  exactly what is recorded.

## 8. Tests that prove it

- Strict responses: an extra field, a wrong type, or non-JSON each give `APPROVER_RESPONSE_REJECTED`;
  explicit `null` for `ref` / `error_code` is accepted (a real server writes nulls).
- The client exposes exactly three methods; the approver answers 404 to any other path.
- The tool mints a fresh request id per ask and refuses a `request_id` argument.
- Every error result is `{"error": CODE}` with a code from §4, nothing else.
- Config: each missing variable, unreadable file and invalid file (empty, junk, key of another certificate,
  a CA file that is not a CA) stops the start with exit 2, without printing a path; an `http:` URL is
  refused; there is no variable that turns mTLS off. The same for the approver, and a bad port or host.
- Store: a request id is used once; at most 50 pending; an ask expires after 10 minutes (with a test clock);
  a decision is final; at most 1,000 asks are kept, never a pending one.
- Recap: a fake recap in a long reason or merchant, padded to any wrap point, cannot begin a line; every
  line fits 76 columns; the characters above are escaped; a look-alike domain shows in punycode.
- Card numbers: found inside longer runs, behind dots, double spaces, underscores, full-width digits and
  %-escapes.
- Transport: an approver that drips bytes is cut off at the deadline; a reply over 64 KiB is refused.
- Approver limits: a body declared too large gets 413 without the approver waiting for it; a body sent
  too large stops being read.
- Docs: SPEC.md is whole, its error codes are the tool's, and every environment variable named in the
  README and here exists in the code.
- mTLS: the approver refuses a client with no certificate and one signed by another CA; the MCP server
  refuses an approver whose certificate is from another CA.
- End to end: the built MCP server and the approver run as real processes; an MCP client asks to pay, the
  test types `approve ID` on the approver's console, and `status` reads `approved`. Same for `deny`.
  A bad call comes back as `INVALID_ARGUMENTS`, not the SDK's validation message.
