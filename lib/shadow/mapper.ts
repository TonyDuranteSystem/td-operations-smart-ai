/**
 * Maps v1 Supabase database webhook payloads to Smart AI event rows.
 * Called by POST /api/shadow/ingest.
 *
 * Shadow events never affect v1 — they are read-only observations of v1 state.
 * subject_type='v1_shadow.*' marks them as non-authoritative in queries.
 */

export type V1WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

export type ShadowEventInsert = {
  event_type: string;
  subject_type: string;
  subject_id: string;
  account_id: string | null;
  actor_type: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  caused_by: string[];
  idempotency_key: string;
};

export class ShadowMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowMapError';
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) {
    throw new ShadowMapError(`${field} is not a valid UUID: ${JSON.stringify(value)}`);
  }
  return value;
}

function nullableUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) return null;
  return value;
}

const TABLE_SUBJECT_TYPE: Record<string, string> = {
  payments: 'v1_shadow.payment',
  leads: 'v1_shadow.lead',
  pending_activations: 'v1_shadow.activation',
};

const TABLE_EVENT_PREFIX: Record<string, string> = {
  payments: 'v1.payment',
  leads: 'v1.lead',
  pending_activations: 'v1.activation',
};

const OP_SUFFIX: Record<string, string> = {
  INSERT: 'created',
  UPDATE: 'updated',
  DELETE: 'deleted',
};

export function mapV1Webhook(payload: V1WebhookPayload): ShadowEventInsert {
  const { type, table, record } = payload;

  if (!record) {
    throw new ShadowMapError(`No record in ${type} payload for table ${table}`);
  }

  const subjectType = TABLE_SUBJECT_TYPE[table];
  const eventPrefix = TABLE_EVENT_PREFIX[table];
  if (!subjectType || !eventPrefix) {
    throw new ShadowMapError(`Unsupported shadow table: ${table}`);
  }

  const opSuffix = OP_SUFFIX[type];
  if (!opSuffix) {
    throw new ShadowMapError(`Unsupported operation: ${type}`);
  }

  const subjectId = requireUuid(record['id'], `${table}.id`);

  // Derive account_id per table
  let accountId: string | null = null;
  if (table === 'payments') {
    accountId = nullableUuid(record['account_id']);
  } else if (table === 'leads') {
    accountId = nullableUuid(record['converted_to_account_id']);
  }
  // pending_activations has no account_id

  // Idempotency: table + op + record id + timestamp (prevents duplicate delivery)
  const ts = String(record['updated_at'] ?? record['created_at'] ?? '');
  const idempotencyKey = `v1:${table}:${type}:${subjectId}:${ts}`;

  return {
    event_type: `${eventPrefix}.${opSuffix}`,
    subject_type: subjectType,
    subject_id: subjectId,
    account_id: accountId,
    actor_type: 'v1_shadow',
    actor_id: null,
    payload: record,
    caused_by: [],
    idempotency_key: idempotencyKey,
  };
}
