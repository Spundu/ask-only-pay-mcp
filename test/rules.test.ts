import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { accountFields, hasCardNumber, isSafeHttpsUrl, payFields } from '../src/rules.js';
import { PAY } from './support/fixtures.js';

const Pay = z.strictObject(payFields);
const Account = z.strictObject(accountFields);
const { verb: _verb, ...pay } = PAY;
const payWith = (change: Record<string, unknown>) => Pay.safeParse({ ...pay, ...change }).success;

describe('pay fields (SPEC.md §3)', () => {
  it('accepts a plain ask', () => {
    expect(payWith({})).toBe(true);
    expect(payWith({ amount: '19', reason: 'renew the domain' })).toBe(true);
    expect(payWith({ amount: '0.01' })).toBe(true);
  });

  it.each(['0', '0.00', '-1', '1e3', '19.001', '019.00', '1,000.00', ' 19.00', '1000000000', '19.'])('refuses the amount %j', (amount) => {
    expect(payWith({ amount })).toBe(false);
  });

  it('refuses an amount that is a number, not a string', () => {
    expect(payWith({ amount: 19 })).toBe(false);
  });

  it.each(['eur', 'EURO', 'E1R', ''])('refuses the currency %j', (currency) => {
    expect(payWith({ currency })).toBe(false);
  });

  it.each(['4111 1111 1111 1111', '4111111111111111', 'Card-2', 'card 2', 'me@example.com', '-card', 'a'.repeat(33)])(
    'refuses the card handle %j',
    (card_handle) => {
      expect(payWith({ card_handle })).toBe(false);
    },
  );

  it.each(['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '378282246310005', '6011000990139424'])(
    'refuses a card number in the reason or merchant: %j',
    (text) => {
      expect(hasCardNumber(text)).toBe(true);
      expect(payWith({ reason: `pay with ${text}` })).toBe(false);
      expect(payWith({ merchant: `Shop ${text}` })).toBe(false);
    },
  );

  it('allows numbers that are not cards: short ones, and 13 digits failing Luhn', () => {
    expect(payWith({ reason: 'order 12345 for 2026, ref 000123456789' })).toBe(true);
    expect(hasCardNumber('1234567890123')).toBe(false);
    expect(isSafeHttpsUrl('https://shop.example/checkout/1234567890123')).toBe(true);
  });

  it.each([
    'order 12345 4111 1111 1111 1111',
    'ref 9 4111111111111111',
    'x 41111111111111110000',
    '4111.1111.1111.1111',
    '4111  1111  1111  1111',
    '4111_1111_1111_1111',
    `${String.fromCodePoint(0xff14)}111111111111111`,
  ])('finds a card inside a longer run, behind other separators, or in full-width digits: %j', (text) => {
    expect(hasCardNumber(text)).toBe(true);
  });

  it('finds a card in a URL, also behind %-escapes', () => {
    expect(isSafeHttpsUrl('https://shop.example/pay?n=9-4111-1111-1111-1111')).toBe(false);
    expect(isSafeHttpsUrl('https://shop.example/pay?n=4111%201111%201111%201111')).toBe(false);
  });

  it('refuses a merchant that is empty or too long, and a reason that is too long', () => {
    expect(payWith({ merchant: '' })).toBe(false);
    expect(payWith({ merchant: 'm'.repeat(121) })).toBe(false);
    expect(payWith({ reason: 'r'.repeat(501) })).toBe(false);
  });

  it('refuses a field it does not know, such as a request id', () => {
    expect(payWith({ request_id: 'mine' })).toBe(false);
  });
});

describe('URLs', () => {
  it.each([
    'http://shop.example/checkout',
    'https://user:pass@shop.example/checkout',
    'https://user@shop.example/',
    'javascript:alert(1)',
    'not a url',
    'https://',
    `https://shop.example/${'a'.repeat(2000)}`,
    'https://shop.example/pay?card=4111111111111111',
  ])('refuses %j', (url) => {
    expect(isSafeHttpsUrl(url)).toBe(false);
  });

  it('accepts a plain https URL with a path and query', () => {
    expect(isSafeHttpsUrl('https://shop.example/checkout/123?step=2')).toBe(true);
  });

  it('applies to the signup URL too, and the identity is a handle', () => {
    expect(Account.safeParse({ provider_url: 'https://service.example/signup' }).success).toBe(true);
    expect(Account.safeParse({ provider_url: 'http://service.example/signup' }).success).toBe(false);
    expect(Account.safeParse({ provider_url: 'https://service.example/signup', identity_handle: 'me@example.com' }).success).toBe(false);
  });
});
