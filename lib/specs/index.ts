/**
 * Service-spec registry. Every spec exported from `lib/specs/` must be
 * added to `allSpecs` below, or the seeder will not publish it.
 *
 * Add-a-new-spec checklist:
 *   (1) Author the spec in its own file (e.g. lib/specs/mmllc-formation.ts)
 *       using `defineSpec(...)` from `./types`.
 *   (2) Import it here and push it onto `allSpecs`.
 *   (3) Unit-test it in tests/unit/specs/<name>.test.ts.
 *   (4) Run `npm run test:unit` — passes before seeding.
 *   (5) Apply the DB seed to sandbox first: see `scripts/seed-specs.ts`.
 */

import type { Spec } from '@/lib/specs/types';
import { smllcFormation } from '@/lib/specs/smllc-formation';

export const allSpecs: readonly Spec[] = [smllcFormation];

export { smllcFormation };
