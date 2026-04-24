/**
 * Pre-emit PII scrubber — architecture §5.4 F10/Round 5, §14.4.
 *
 * Minimal Stage-0 implementation. Walks an event payload, detects PII in
 * string values + suspicious key names, inserts each detection into the
 * `sensitive_data` table, and replaces the in-payload value with the token.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS CATCHES (S0.3 minimum viable set):
 *   - Email addresses    (regex: RFC-5322 approximation)
 *   - US / international phone numbers (regex)
 *   - Values whose KEY name matches a PII suspect list
 *     (name, full_name, first_name, last_name, email, phone, ssn, ein, dob).
 *
 * WHAT THIS DOES NOT CATCH (Stage 1+ work):
 *   - SSN / EIN numbers embedded in free text without a labelled key
 *   - DOB in free text
 *   - Addresses (street / city / zip)
 *   - Named-entity recognition (Anthropic / OpenAI-backed detection)
 *   - Credit-card numbers (PCI scope — separate review required)
 *   - PII in nested binary blobs (Stage 1 adds file-stream scanning)
 *
 * The purpose of the minimum is to keep free-form admin reasons, chat
 * messages, and communication payloads from flowing into `events` in the
 * clear. Structured fields (contact_id, account_id) already point at PII
 * indirectly via the `contacts.*_token` columns; this scrubber is the
 * catch-net for unstructured surface area.
 *
 * Storage contract (migration 002): `sensitive_data` has columns
 *   `token TEXT UNIQUE` and `encrypted_value TEXT`. At Stage 0 the
 *   "encrypted_value" is the raw detected string — encryption-at-rest is
 *   Stage 1+ (architecture §14.3). GDPR soft-delete works by nulling
 *   encrypted_value; deleted_at records the time.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// Detection primitives
// ---------------------------------------------------------------------------

// Email: common-case RFC-5322 subset. Not every edge case, intentionally —
// overfitting the regex would widen the rule without improving precision.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Phone: at least 7 digits with common separators, optional leading +.
// Intentionally NOT anchored, so it fires on phones mid-text.
const PHONE_RE = /(\+?\d[\d\s()\-.]{6,}\d)/;

// Suspicious key names — exact match, lower-cased.
const PII_SUSPECT_KEYS = new Set<string>([
  'name',
  'full_name',
  'fullname',
  'first_name',
  'firstname',
  'last_name',
  'lastname',
  'email',
  'email_address',
  'phone',
  'phone_number',
  'ssn',
  'ein',
  'dob',
  'date_of_birth',
]);

type DataType = 'email' | 'phone' | 'name' | 'generic_pii';

function classifyKey(keyName: string): DataType | null {
  const k = keyName.toLowerCase();
  if (!PII_SUSPECT_KEYS.has(k)) return null;
  if (k.includes('email')) return 'email';
  if (k.includes('phone')) return 'phone';
  if (k.includes('name')) return 'name';
  return 'generic_pii';
}

function classifyValue(s: string): DataType | null {
  if (EMAIL_RE.test(s)) return 'email';
  if (PHONE_RE.test(s)) return 'phone';
  return null;
}

// ---------------------------------------------------------------------------
// Token mint — inserts into sensitive_data and returns the token string.
// ---------------------------------------------------------------------------

async function mintToken(raw: string, dataType: DataType): Promise<string> {
  const token = `pii:${crypto.randomUUID()}`;
  const { error } = await supabaseAdmin
    .from('sensitive_data')
    .insert({
      token,
      encrypted_value: raw,    // S0.3: raw storage; encryption-at-rest lands in Stage 1.
      data_type: dataType,
    });
  if (error) {
    // Surface a scrubbing failure loudly — silently returning raw PII into
    // the payload would defeat the entire mechanism.
    throw new Error(`scrubPayloadForPII: sensitive_data insert failed: ${error.message}`);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Recursive walk over JSON-ish payloads.
// ---------------------------------------------------------------------------

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

async function scrubValue(value: JsonValue, keyHint: string | null): Promise<JsonValue> {
  if (value === null) return null;

  if (typeof value === 'string') {
    const byKey   = keyHint ? classifyKey(keyHint) : null;
    const byValue = classifyValue(value);
    const detected = byKey ?? byValue;
    if (detected !== null && value.length > 0) {
      return await mintToken(value, detected);
    }
    return value;
  }

  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) {
      out.push(await scrubValue(item, null));
    }
    return out;
  }

  if (typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await scrubValue(v as JsonValue, k);
    }
    return out;
  }

  // number | boolean — pass through
  return value;
}

/**
 * Scrub a payload just before it is written to the events table.
 *
 * `eventType` is currently unused but reserved: per-event-type scrubbing
 * policies (which fields are free-form vs structured) will land in Stage 1.
 * The argument is kept now to preserve the call-site signature — callers
 * in `lib/events/emit.ts` pass `event_type` and no migration is required
 * when the per-type policy matrix arrives.
 */
export async function scrubPayloadForPII(
  _eventType: string,
  payload: unknown,
): Promise<unknown> {
  // Defensive: non-object payloads (e.g. naked strings) still walk through
  // the string-detection path.
  return scrubValue(payload as JsonValue, null);
}
