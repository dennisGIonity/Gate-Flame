/* ========================================================================================
 * GATE^FLAME MOBILE - A PAIRED PHONE IS NOT CALLED "LINUX"
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ======================================================================================== */

import { describe, expect, it } from 'vitest';

import { FALLBACK_DEVICE_NAME, defaultDeviceName, refineDeviceName } from './deviceName';

const S10E_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 12; SM-G970F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36';
const PIXEL_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const REDUCED_ANDROID =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('defaultDeviceName', () => {
  it('names Dennis’s S10e by its model, not "Linux"', () => {
    expect(defaultDeviceName(S10E_WEBVIEW)).toBe('SM-G970F');
  });

  it('reads a model with no Build/ suffix', () => {
    expect(defaultDeviceName(PIXEL_CHROME)).toBe('Pixel 8');
  });

  it('treats the reduced-UA placeholder "K" as no model at all', () => {
    expect(defaultDeviceName(REDUCED_ANDROID)).toBe(FALLBACK_DEVICE_NAME);
  });

  it('falls back to the platform family on iOS', () => {
    expect(defaultDeviceName(IPHONE)).toBe('iPhone');
  });

  it('is "My phone" on anything it does not understand, including a desktop and an empty string', () => {
    expect(defaultDeviceName(DESKTOP)).toBe(FALLBACK_DEVICE_NAME);
    expect(defaultDeviceName('')).toBe(FALLBACK_DEVICE_NAME);
    expect(defaultDeviceName(undefined)).toBe(FALLBACK_DEVICE_NAME);
  });

  it('never returns the old defect: the first parenthesised token', () => {
    // The original code: ua.split('(')[1]?.split(';')[0] → "Linux".
    expect(defaultDeviceName(S10E_WEBVIEW)).not.toBe('Linux');
    expect(defaultDeviceName(REDUCED_ANDROID)).not.toBe('Linux');
  });
});

describe('refineDeviceName (User-Agent Client Hints)', () => {
  it('returns the model when the API has one', async () => {
    const nav = { userAgentData: { getHighEntropyValues: async () => ({ model: 'SM-G970F' }) } } as unknown as Navigator;
    await expect(refineDeviceName(nav)).resolves.toBe('SM-G970F');
  });

  it('returns null for the placeholder, an empty model, a refusal, or no API', async () => {
    const k = { userAgentData: { getHighEntropyValues: async () => ({ model: 'K' }) } } as unknown as Navigator;
    const empty = { userAgentData: { getHighEntropyValues: async () => ({ model: '' }) } } as unknown as Navigator;
    const refuses = {
      userAgentData: {
        getHighEntropyValues: async () => {
          throw new Error('NotAllowedError');
        },
      },
    } as unknown as Navigator;
    await expect(refineDeviceName(k)).resolves.toBeNull();
    await expect(refineDeviceName(empty)).resolves.toBeNull();
    await expect(refineDeviceName(refuses)).resolves.toBeNull();
    await expect(refineDeviceName({} as Navigator)).resolves.toBeNull();
    await expect(refineDeviceName(undefined)).resolves.toBeNull();
  });
});
