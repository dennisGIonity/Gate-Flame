/**
 * Gate^Flame mobile — a sensible default for "This phone's name".
 *
 * The name is what the kiosk's paired-devices list shows, and the only thing
 * an owner has to go on when revoking a lost or sold handset. Until 2026-10-02
 * the default was the first token inside the user agent's parentheses, which
 * on every Android WebView is the word "Linux" — so each phone paired as
 * "Linux" unless the customer noticed and retyped it, and a list of three
 * "Linux" entries cannot be revoked safely.
 *
 * Order of preference:
 *   1. The device model from the user agent — `SM-G970F`, `Pixel 8` — which
 *      is at least distinctive. Modern WebViews reduce the UA and send the
 *      placeholder model "K", which is treated as absent.
 *   2. The platform family: iPhone, iPad.
 *   3. "My phone".
 *
 * `refineDeviceName` can upgrade (1) later from User-Agent Client Hints, which
 * still carry the real model on a reduced UA. It is async and best-effort; the
 * screen only accepts the answer if the owner has not typed their own.
 */

export const FALLBACK_DEVICE_NAME = 'My phone';

/** Pure: from a UA string to a default name. Never throws, never empty. */
export function defaultDeviceName(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return FALLBACK_DEVICE_NAME;

  // Android: "(Linux; Android 14; SM-G970F Build/UP1A...)" or reduced "(Linux; Android 10; K)".
  const android = /Android\s[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/i.exec(ua);
  if (android) {
    const model = android[1].trim();
    if (model && model.toUpperCase() !== 'K' && !/^wv$/i.test(model)) return model.slice(0, 48);
  }

  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';

  return FALLBACK_DEVICE_NAME;
}

interface UaDataLike {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>;
}

/**
 * Ask User-Agent Client Hints for the real model. Resolves to null when the
 * API is absent, refuses, or has nothing better than the placeholder.
 */
export async function refineDeviceName(nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined): Promise<string | null> {
  try {
    const uaData = (nav as (Navigator & { userAgentData?: UaDataLike }) | undefined)?.userAgentData;
    if (!uaData?.getHighEntropyValues) return null;
    const { model } = await uaData.getHighEntropyValues(['model']);
    const trimmed = (model ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'K') return null;
    return trimmed.slice(0, 48);
  } catch {
    return null;
  }
}
