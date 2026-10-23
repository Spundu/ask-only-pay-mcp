import { describe, expect, it } from 'vitest';
import { command } from '../src/approver/console.js';
import { recap, safe } from '../src/approver/recap.js';
import { MAX_KEPT, MAX_PENDING, Store, TTL_SECONDS, type AskBody } from '../src/approver/store.js';

const PAY: AskBody = { kind: 'pay', fields: { merchant: 'Example Shop', amount: '19.00', currency: 'EUR', card_handle: 'card-2', checkout_url: 'https://shop.example/checkout/123' } };

function clockAt(start: number) {
  const clock = { now: start, fn: () => clock.now };
  return clock;
}

describe('the approver store (SPEC.md §6, §7)', () => {
  it('stores an ask as pending with a 10-minute expiry and a base32 id', () => {
    const c = clockAt(1000);
    const added = new Store(c.fn).add(PAY, 'r1');
    expect(added.ok && added.ask).toMatchObject({ state: 'pending', createdAt: 1000, expiresAt: 1000 + TTL_SECONDS });
    expect(added.ok && added.ask.id).toMatch(/^[A-Z2-7]{10}$/);
  });

  it('refuses a request id it has seen, even after that ask was decided', () => {
    const s = new Store();
    const first = s.add(PAY, 'r1');
    if (first.ok) s.decide(first.ask.id, 'deny');
    expect(s.add(PAY, 'r1')).toEqual({ ok: false, error: 'duplicate_request' });
  });

  it('holds at most 50 pending asks', () => {
    const s = new Store();
    for (let i = 0; i < MAX_PENDING; i++) expect(s.add(PAY, `r${i}`).ok).toBe(true);
    expect(s.add(PAY, 'one-more')).toEqual({ ok: false, error: 'too_many_pending' });
  });

  it('expires an ask that was not decided in time, and an expired ask cannot be approved', () => {
    const c = clockAt(1000);
    const s = new Store(c.fn);
    const added = s.add(PAY, 'r1');
    if (!added.ok) throw new Error('not added');
    c.now = 1000 + TTL_SECONDS - 1;
    expect(s.get(added.ask.id)?.state).toBe('pending');
    c.now = 1000 + TTL_SECONDS;
    expect(s.get(added.ask.id)?.state).toBe('expired');
    expect(s.decide(added.ask.id, 'approve')).toEqual({ ok: false, error: 'not_pending' });
    expect(s.pending()).toEqual([]);
  });

  it('keeps at most 1,000 asks, forgetting the oldest decided ones and their request ids', () => {
    const s = new Store();
    const ids: string[] = [];
    for (let i = 0; i < MAX_KEPT + 100; i++) {
      const added = s.add(PAY, `r${i}`);
      if (!added.ok) throw new Error('not added');
      s.decide(added.ask.id, 'deny');
      ids.push(added.ask.id);
    }
    expect(s.get(ids[0]!)).toBeUndefined();
    expect(s.get(ids[99]!)).toBeUndefined();
    expect(s.get(ids[100]!)?.state).toBe('denied');
    expect(s.get(ids.at(-1)!)?.state).toBe('denied');
    // The memory of request ids is bounded the same way.
    expect(s.add(PAY, 'r0').ok).toBe(true);
    expect(s.add(PAY, `r${MAX_KEPT + 99}`)).toEqual({ ok: false, error: 'duplicate_request' });
  });

  it('never forgets a pending ask to make room', () => {
    const s = new Store();
    const pending = s.add(PAY, 'pending');
    if (!pending.ok) throw new Error('not added');
    for (let i = 0; i < MAX_KEPT + 10; i++) {
      const added = s.add(PAY, `r${i}`);
      if (added.ok) s.decide(added.ask.id, 'deny');
    }
    expect(s.get(pending.ask.id)?.state).toBe('pending');
  });

  it('makes a decision final: a denied ask cannot be approved, an approved one cannot be denied', () => {
    const s = new Store();
    const a = s.add(PAY, 'a');
    const b = s.add(PAY, 'b');
    if (!a.ok || !b.ok) throw new Error('not added');
    expect(s.decide(a.ask.id, 'deny')).toMatchObject({ ok: true });
    expect(s.decide(a.ask.id, 'approve')).toEqual({ ok: false, error: 'not_pending' });
    expect(s.decide(b.ask.id, 'approve')).toMatchObject({ ok: true });
    expect(s.get(b.ask.id)?.ref).toMatch(/^demo-[0-9a-f]{8}$/);
    expect(s.decide(b.ask.id, 'deny')).toEqual({ ok: false, error: 'not_pending' });
  });
});

describe('the recap', () => {
  it('shows what the person is approving, from the stored ask', () => {
    const s = new Store(() => 1000);
    const added = s.add({ ...PAY, fields: { ...PAY.fields, reason: 'renew the domain' } } as AskBody, 'r');
    if (!added.ok) throw new Error('not added');
    const text = recap(added.ask, 1000);
    expect(text).toContain(`[ask ${added.ask.id}] PAY 19.00 EUR`);
    expect(text).toContain('to:        Example Shop');
    expect(text).toContain('site:      shop.example');
    expect(text).toContain('  reason:    (from the agent, unchecked) renew the domain');
    expect(text).toContain('expires:   in 10 min');
  });

  it('shows a look-alike domain in its real (punycode) form', () => {
    const s = new Store();
    // "shop.exаmple" with a Cyrillic а
    const added = s.add({ kind: 'pay', fields: { ...PAY.fields, checkout_url: `https://shop.ex${String.fromCodePoint(0x430)}mple/c` } } as AskBody, 'r');
    if (!added.ok) throw new Error('not added');
    expect(recap(added.ask, 0)).toContain('site:      shop.xn--exmple-');
  });

  it('escapes control, bidi and zero-width characters so text cannot redraw the terminal or hide digits', () => {
    const esc = String.fromCodePoint(0x1b);
    const rlo = String.fromCodePoint(0x202e);
    const zw = String.fromCodePoint(0x200b);
    expect(safe(`Shop${esc}[2J`)).toBe('Shop\\u{1b}[2J');
    expect(safe(`19${rlo}00`)).toBe('19\\u{202e}00');
    expect(safe(`a${zw}b\nc`)).toBe('a\\u{200b}b\\u{a}c');
    expect(safe('Café — plain text')).toBe('Café — plain text');
  });
});

describe('the console', () => {
  it('approves, denies and lists, and a decision is final', () => {
    const s = new Store();
    const a = s.add(PAY, 'a');
    const b = s.add(PAY, 'b');
    if (!a.ok || !b.ok) throw new Error('not added');
    expect(command('list', s)).toContain(a.ask.id);
    const approved = command(`approve ${a.ask.id.toLowerCase()}`, s).split('\n');
    expect(approved[0]).toBe(`${a.ask.id}: approved: PAY 19.00 EUR at shop.example`);
    expect(approved[1]).toMatch(/^ {2}demo-[0-9a-f]{8}: no money moved/);
    expect(command(`deny ${a.ask.id}`, s)).toBe(`${a.ask.id} is already approved: a decision is final`);
    expect(command(`deny ${b.ask.id}`, s)).toBe(`${b.ask.id}: denied: PAY 19.00 EUR at shop.example`);
    expect(command('list', s)).toBe('no pending asks');
    expect(command('approve AAAAAAAAAA', s)).toBe('no ask AAAAAAAAAA');
  });

  it('answers anything else with the help line', () => {
    const s = new Store();
    for (const line of ['approve', 'approve A B', 'yes', 'list all']) expect(command(line, s)).toMatch(/^commands:/);
    expect(command('   ', s)).toBe('');
  });
});
