/**
 * Inngest serve handler — architecture §17.4, lines 3843-3850.
 *
 * Next.js App Router route. Inngest's dashboard syncs here to register
 * every function exported from `lib/inngest/index.ts`. On every function
 * invocation (cron tick, event receipt), Inngest POSTs to this endpoint
 * and the SDK dispatches to the matching function.
 *
 * Security: request signatures are verified by the Inngest SDK using
 * INNGEST_SIGNING_KEY (env var). Unsigned requests are rejected.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/workflows/inngest-client';
import { functions } from '@/lib/inngest';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
