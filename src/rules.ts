// The field rules of an ask (SPEC.md §3), shared by the MCP server and the approver. The approver applies
// them again itself: it never trusts the MCP server's checks (SPEC.md §6).

import { z } from 'zod';

/** A name for a card or an identity, never the thing itself (SPEC.md §2.5). */
export const HANDLE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** The approver's ids: 10 characters of base32 (RFC 4648 alphabet). */
export const APPROVAL_ID = /^[A-Z2-7]{10}$/;
const AMOUNT = /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
/** 13 or more digits, each pair split by at most two spaces, dots, dashes, underscores, pluses or commas. */
const DIGIT_RUN = /[0-9](?:[ ._+,-]{0,2}[0-9]){12,}/g;

/** The Luhn checksum that every card number passes (and a random digit string passes one time in ten). */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * True if the text holds a card number: 13 to 19 digits in a row (with separators allowed, after full-width
 * digits are read as digits and %-escapes decoded) that pass Luhn, anywhere inside a longer run too. So a
 * long digit run is refused almost always: a random 13-digit window passes Luhn one time in ten.
 *
 * This catches a card pasted by mistake; it is no defence against an agent set on hiding one (it could
 * spell the digits out), which is why the agent should never see a card at all.
 */
export function hasCardNumber(text: string): boolean {
  // Each %XX is decoded on its own, so one stray % elsewhere cannot stop the decoding (as it would
  // decodeURIComponent's). Byte by byte is enough: digits and separators are ASCII.
  const decoded = text.replace(/%([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const forms = new Set([text.normalize('NFKC'), decoded.normalize('NFKC')]);
  for (const form of forms) {
    for (const [run] of form.matchAll(DIGIT_RUN)) {
      const digits = run.replace(/[ ._+,-]/g, '');
      for (let start = 0; start + 13 <= digits.length; start++) {
        for (let len = 13; len <= 19 && start + len <= digits.length; len++) {
          if (luhn(digits.slice(start, start + len))) return true;
        }
      }
    }
  }
  return false;
}

const noCardNumber = (s: string) => !hasCardNumber(s);

/** Free text an agent writes: refused if it carries a card number. */
const text = (max: number) => z.string().max(max).refine(noCardNumber, 'looks like a card number');
/** "4111111111111111" fits the handle grammar, so a handle is refused on the same rule. */
const handle = z.string().regex(HANDLE).refine(noCardNumber, 'looks like a card number');

/** An https URL with no user name or password in it: a URL is shown to a person, never a credential. */
export function isSafeHttpsUrl(value: string): boolean {
  if (value.length > 2000 || hasCardNumber(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const ok = url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname !== '';
  // The URL as stored and shown (below) is the resolved one: it obeys the same limits.
  return ok && url.href.length <= 2000 && !hasCardNumber(url.href);
}

/**
 * An ask's URL is stored, shown and passed on as the browser resolves it (`href`), never as the agent wrote
 * it: `https://shop.example\@evil.com` is shown as `https://shop.example/@evil.com` with site `shop.example`,
 * and a payment step that parsed the raw text another way could have read the host as `evil.com`.
 */
const httpsUrl = z.string().refine(isSafeHttpsUrl, 'must be an https URL without credentials').transform((s) => new URL(s).href);

export const payFields = {
  merchant: text(120).min(1),
  amount: z.string().regex(AMOUNT).refine((s) => /[1-9]/.test(s), 'must be above 0'),
  currency: z.string().regex(CURRENCY),
  card_handle: handle,
  checkout_url: httpsUrl,
  reason: text(500).optional(),
};

export const accountFields = {
  provider_url: httpsUrl,
  identity_handle: handle.optional(),
  reason: text(500).optional(),
};

export type PayFields = z.infer<z.ZodObject<typeof payFields>>;
export type AccountFields = z.infer<z.ZodObject<typeof accountFields>>;

export const STATES = ['pending', 'approved', 'denied', 'expired'] as const;
export type State = (typeof STATES)[number];
