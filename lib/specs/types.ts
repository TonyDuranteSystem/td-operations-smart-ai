/**
 * Specification DSL — architecture §6.1 / §6.4.
 *
 * TypeScript-authored specs live in `lib/specs/`. Each spec is typed,
 * Zod-validated at author time, committed to the repo, and seeded to the
 * `service_specs` table on deploy via `scripts/seed-specs.ts`.
 *
 * Four requirement kinds, all discriminated on the `kind` field:
 *   - gate        (hard prerequisite — blocks others until met)
 *   - data        (entity field must meet a predicate)
 *   - document    (a typed document attached to an entity)
 *   - deliverable (an event of the specified type has occurred)
 *
 * The DSL constructor helpers (`ReqGate`, `ReqData`, `ReqDocument`,
 * `ReqDeliverable`) do two jobs: tag the `kind` literal for the discriminated
 * union, and parse through Zod so malformed input is caught at import time,
 * not at runtime when the solver tries to evaluate the spec.
 *
 * `defineSpec` is the top-level constructor. It Zod-validates the whole spec
 * and additionally walks the dependency DAG to reject cycles (a cycle makes
 * the solver loop) and unresolved dependency keys (a key in `depends_on`
 * that no other requirement exports).
 *
 * Note on naming: the DB migration (supabase/migrations/004_spec_rules.sql)
 * uses `contract_type` where architecture §6.2 shows `service_type`. We use
 * `contract_type` in the DSL, matching the actual DB column. The full
 * TypeScript spec object is serialized into `service_specs.spec_json`;
 * additional fields (display_name, pricing_rules, follow_up_rules,
 * exceptions_config) live inside the JSONB, not as separate columns.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Requirement kind schemas
// ---------------------------------------------------------------------------

const BaseRequirementFields = {
  key: z.string().min(1),
  depends_on: z.array(z.string()).optional().default([]),
  blocks: z.array(z.string()).optional().default([]),
  per_member: z.boolean().optional().default(false),
  per_account: z.boolean().optional().default(false),
  requires_signer: z.boolean().optional().default(false),
  ai_hint: z.string().optional(),
  ai_evaluable: z.boolean().optional().default(false),
  overridable: z.boolean().optional().default(false),
};

/**
 * Gate — a hard prerequisite. `blocks: ['*']` means it blocks every other
 * requirement until its condition is met. Payment is the canonical gate.
 */
export const ReqGateSchema = z.object({
  kind: z.literal('gate'),
  ...BaseRequirementFields,
  condition: z.object({
    event_type: z.string().min(1),
    subject: z.string().optional(),
  }),
});

/**
 * Data — a field on an entity must have a value (optionally in a set).
 * `when_account_null` supplies a fallback path (e.g.
 * `engagement.metadata.company_name`) for pre-account wizard data.
 */
export const ReqDataSchema = z.object({
  kind: z.literal('data'),
  ...BaseRequirementFields,
  condition: z.object({
    field: z.string().min(1),
    not_null: z.boolean().optional(),
    in: z.array(z.string()).optional(),
    when_account_null: z.string().optional(),
  }),
});

/**
 * Document — a document of the declared type exists against an entity.
 * When `per_member: true`, the solver expects one document per active
 * member (architecture §5.3 Fix F7 — satisfaction fires only when all
 * members have a document).
 */
export const ReqDocumentSchema = z.object({
  kind: z.literal('document'),
  ...BaseRequirementFields,
  doc_type: z.string().min(1),
  condition: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Deliverable — an event of the declared type has occurred for the subject,
 * indicating TD has produced an output (filed something, received something,
 * sent something).
 */
export const ReqDeliverableSchema = z.object({
  kind: z.literal('deliverable'),
  ...BaseRequirementFields,
  condition: z.object({
    event_type: z.string().min(1),
    subject: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const RequirementSchema = z.discriminatedUnion('kind', [
  ReqGateSchema,
  ReqDataSchema,
  ReqDocumentSchema,
  ReqDeliverableSchema,
]);

export type Requirement = z.infer<typeof RequirementSchema>;
export type ReqGate = z.infer<typeof ReqGateSchema>;
export type ReqData = z.infer<typeof ReqDataSchema>;
export type ReqDocument = z.infer<typeof ReqDocumentSchema>;
export type ReqDeliverable = z.infer<typeof ReqDeliverableSchema>;

// ---------------------------------------------------------------------------
// Spec-level schema
// ---------------------------------------------------------------------------

export const SpecSchema = z.object({
  /** DB column (migration 004). Architecture §6.1/§6.2 calls this `service_type`;
   *  we use `contract_type` to match the shipped schema exactly. */
  contract_type: z.string().min(1),
  display_name: z.string().min(1),
  version: z.number().int().positive(),
  pricing_rules: z.record(z.string(), z.unknown()).optional().default({}),
  requirements: z.array(RequirementSchema).min(1),
  follow_up_rules: z.record(z.string(), z.unknown()).optional().default({}),
  exceptions_config: z.record(z.string(), z.unknown()).optional().default({}),
});

export type Spec = z.infer<typeof SpecSchema>;

// ---------------------------------------------------------------------------
// DSL constructor helpers — tag `kind` and parse each kind's schema so
// malformed input throws at import time, not during solver evaluation.
// ---------------------------------------------------------------------------

type GateInput = Omit<z.input<typeof ReqGateSchema>, 'kind'>;
type DataInput = Omit<z.input<typeof ReqDataSchema>, 'kind'>;
type DocumentInput = Omit<z.input<typeof ReqDocumentSchema>, 'kind'>;
type DeliverableInput = Omit<z.input<typeof ReqDeliverableSchema>, 'kind'>;

export function ReqGate(input: GateInput): ReqGate {
  return ReqGateSchema.parse({ ...input, kind: 'gate' });
}
export function ReqData(input: DataInput): ReqData {
  return ReqDataSchema.parse({ ...input, kind: 'data' });
}
export function ReqDocument(input: DocumentInput): ReqDocument {
  return ReqDocumentSchema.parse({ ...input, kind: 'document' });
}
export function ReqDeliverable(input: DeliverableInput): ReqDeliverable {
  return ReqDeliverableSchema.parse({ ...input, kind: 'deliverable' });
}

// ---------------------------------------------------------------------------
// Dependency DAG validation
// ---------------------------------------------------------------------------

export class SpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecValidationError';
  }
}

/**
 * Walk the `depends_on` graph. Throws if:
 *   - A `depends_on` key references a requirement that does not exist in
 *     this spec (typos, stale refs after rename).
 *   - A cycle exists. Cycles would make the solver loop.
 *
 * `blocks` is inverse-directional (a gate blocking others) and is NOT part
 * of the DAG walked here. The solver treats `blocks` as a one-way gating
 * signal, not a dependency.
 */
export function validateDependencyDag(spec: Spec): void {
  const keys = new Set(spec.requirements.map(r => r.key));

  // Missing-key check.
  for (const req of spec.requirements) {
    for (const dep of req.depends_on) {
      if (!keys.has(dep)) {
        throw new SpecValidationError(
          `spec "${spec.contract_type}" v${spec.version}: requirement "${req.key}" ` +
          `depends on "${dep}", which does not exist.`,
        );
      }
    }
  }

  // Cycle detection via DFS with white/gray/black coloring.
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  for (const k of keys) color.set(k, 'white');

  const depsOf = new Map<string, string[]>();
  for (const req of spec.requirements) depsOf.set(req.key, req.depends_on);

  function visit(node: string, path: string[]): void {
    const c = color.get(node);
    if (c === 'black') return;
    if (c === 'gray') {
      const cycleStart = path.indexOf(node);
      const cycle = cycleStart >= 0 ? path.slice(cycleStart).concat(node).join(' → ') : node;
      throw new SpecValidationError(
        `spec "${spec.contract_type}" v${spec.version}: dependency cycle detected: ${cycle}`,
      );
    }
    color.set(node, 'gray');
    for (const dep of depsOf.get(node) ?? []) {
      visit(dep, path.concat(node));
    }
    color.set(node, 'black');
  }

  for (const k of keys) visit(k, []);
}

// ---------------------------------------------------------------------------
// Top-level constructor — validates + DAG check.
// ---------------------------------------------------------------------------

export function defineSpec(input: z.input<typeof SpecSchema>): Spec {
  const spec = SpecSchema.parse(input);

  // Unique-key check within the spec. Zod's array schema does not detect
  // this by default; a duplicate key would produce non-deterministic solver
  // behaviour (which requirement wins).
  const keys: string[] = spec.requirements.map(r => r.key);
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) {
      throw new SpecValidationError(
        `spec "${spec.contract_type}" v${spec.version}: duplicate requirement key "${k}".`,
      );
    }
    seen.add(k);
  }

  validateDependencyDag(spec);
  return spec;
}
