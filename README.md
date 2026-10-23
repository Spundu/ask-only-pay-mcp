# ask-only-pay-mcp

[![CI](https://github.com/Spundu/ask-only-pay-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Spundu/ask-only-pay-mcp/actions/workflows/ci.yml)

**An MCP server that lets an AI agent ask for a payment or an account signup, but never do it.**

A person approves each ask on a recap that a separate process, the approver, renders itself. The agent
gets back only an id and a state: never a card, a password, or the recap.

```
 AI agent ──MCP──▶ ask-only-pay-mcp ──HTTPS + mTLS──▶ approver ──▶ person at a terminal
   "pay 19.00 EUR       mints the id,                   stores the ask,     reads the recap,
    to Example Shop"    checks every field              shows the recap     types approve / deny
        ◀── {approval_id, state} ────────◀── {approval_id, state, ref} ──┘
```

## Why

Agents that browse the web reach checkouts and signup forms. Letting one type a card number or a
password is how money and accounts get lost, and a prompt-injected page can talk an agent into almost
anything. The usual fix is a rule in the prompt: "ask before you pay". A rule can be argued with.

This project makes the agent's side **powerless by construction** instead:

| property | how it is enforced |
|---|---|
| It can only ask. | The client has three methods: ask to pay, ask to create an account, read a status. There is no approve, cancel or execute method, and the approver has no HTTP endpoint for one. Approval happens only on the approver's own console. |
| Nothing secret comes back. | Every answer from the approver is parsed against a strict schema. An extra field (a recap, a card, a token) fails the parse, and the agent gets an error code instead of the data. |
| What the person approves is what is recorded. | The approver renders the recap from the ask it stored. An ask cannot be changed after it was made, and a decision is final. |
| It cannot replay an ask. | The server mints the request id, never the agent. The approver refuses an id it has seen. |
| Errors are codes. | A failure returns `{"error": "CODE"}`: never a message, URL or response body that could carry something the agent should not see. |
| No secrets in arguments. | A card is a handle (`card-2`), an identity a handle (`work`). A field that holds a card number (13–19 digits passing Luhn) is refused. |
| No silent fallback. | mTLS is required, and there is no switch to turn it off. Missing or unreadable configuration stops the server before it serves anything. |

The recap also defends the person: control characters, bidirectional overrides and zero-width
characters in an ask are shown as escapes (so a merchant name cannot redraw the terminal or hide a
digit), and the site is shown in punycode (so `shop.exаmple` with a Cyrillic `а` shows as `xn--…`).

## Quick start (from a clone)

Needs Node.js 22.12 or later, and `openssl` for the certificates.

```bash
git clone https://github.com/Spundu/ask-only-pay-mcp.git
cd ask-only-pay-mcp
npm ci                      # also builds dist/
npm run certs -- certs      # two separate CAs and two certificates, in ./certs (git-ignored)
```

**1. Start the approver** in a terminal of its own:

```bash
ASK_ONLY_PAY_APPROVER_CERT=certs/approver.pem \
ASK_ONLY_PAY_APPROVER_KEY=certs/approver.key \
ASK_ONLY_PAY_APPROVER_CA=certs/client-ca.pem \
node dist/approver/main.js
```

**2. Add the MCP server** to Claude Code (from the clone's folder):

```bash
claude mcp add --transport stdio ask-only-pay \
  -e ASK_ONLY_PAY_URL=https://localhost:8443 \
  -e ASK_ONLY_PAY_CLIENT_CERT="$PWD/certs/client.pem" \
  -e ASK_ONLY_PAY_CLIENT_KEY="$PWD/certs/client.key" \
  -e ASK_ONLY_PAY_CA="$PWD/certs/approver-ca.pem" \
  -- node "$PWD/dist/index.js"
```

**3. Ask Claude** to buy something. The approver's terminal shows:

```
[ask K7Q2M4XZ3A] PAY 19.00 EUR
  to:        Example Shop
  card:      card-2
  checkout:  https://shop.example/checkout/123
  site:      shop.example
  agent's reason (unchecked): renew the domain
  expires:   in 10 min
  approve K7Q2M4XZ3A   or   deny K7Q2M4XZ3A
```

Type `approve K7Q2M4XZ3A` or `deny K7Q2M4XZ3A`. `list` shows what is pending. Claude reads the decision
with the `status` verb.

## The tool

One tool, `request`, with three verbs:

| verb | the agent gives | it gets back |
|---|---|---|
| `pay` | `merchant`, `amount` (a decimal string such as `"19.00"`), `currency` (`EUR`), `card_handle`, `checkout_url`, optional `reason` | `{approval_id, state: "pending", expires_at}` |
| `account_create` | `provider_url`, optional `identity_handle` and `reason` | the same |
| `status` | `approval_id` | `{approval_id, state, ref?}`: `pending`, `approved`, `denied` or `expired` |

The tool description tells the agent that "pending" and "denied" are normal answers, not obstacles to
work around. Every field rule, error code and limit is in [SPEC.md](SPEC.md).

## What the reference approver is, and is not

The approver here is a **reference**. On approval it records a reference starting `demo-` and moves no
money. A real deployment keeps the same three endpoints and puts a real payment or signup step behind
the approval.

Limits worth knowing:

- **Where the approver runs matters.** Its console is the approval channel. Run it where the agent
  cannot type: another user account, another machine, or at least a terminal the agent has no access to.
  If the agent has a shell as the same user on the same machine, it can reach anything that user can.
- **The client key only lets you ask.** An agent that reads `client.key` can make more asks, which the
  person sees and denies. It cannot approve one.
- **The card check is a net, not a wall.** It catches a card number pasted by mistake. An agent set on
  leaking one could spell the digits out. The real defence is that the agent never sees a card.
- **Memory only.** The approver keeps asks in memory. A restart forgets them, which denies nothing that
  was not yet approved.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test            # unit, real mTLS, and end to end with the built programs
```

The end-to-end tests start the built approver and the built MCP server as real processes, connect an MCP
client, and type `approve` and `deny` on the approver's console, as a person would. The mTLS tests use
fresh certificates from `scripts/certs.mjs` and check that the approver refuses a client with no
certificate, one from another CA, and its own certificate used as a client.

## Related

- [money-guard-mcp](https://github.com/Spundu/money-guard-MCP): an MCP server that **checks** how a
  project handles money (float columns, unbalanced ledgers, tampered audit logs). This one **gates** the
  money an agent wants to spend.
- [agent-shell-gate](https://github.com/Spundu/agent-shell-gate): a permission gate for an agent's shell
  commands.

## Licence

MIT. See [LICENSE](LICENSE).
