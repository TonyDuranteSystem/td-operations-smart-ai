/**
 * Inngest function registry — barrel file.
 *
 * Every Inngest function exported from `lib/inngest/functions/` must be
 * re-exported here, then added to the `functions` array below. The
 * `app/api/inngest/route.ts` serve handler reads `functions` directly;
 * a function not in this array does NOT run.
 */

import { outboxDrain } from '@/lib/inngest/functions/outbox-drain';

export const functions = [outboxDrain];
