/**
 * Inngest singleton client — architecture §17.4 Fix O.
 *
 * This is the ONLY file in the repo allowed to import from `inngest`.
 * Every other module must depend on `@/lib/workflows/engine` (the
 * abstraction layer) so the workflow engine can be swapped without
 * touching feature code.
 *
 * The `no-restricted-imports` ESLint rule blocks `import ... from 'inngest'`
 * outside this file, with an override registered for this path in
 * .eslintrc.json.
 */

import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'td-operations-smart-ai',
  // INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are read from env by the SDK.
  // They are set in Vercel (td-operations-v2) per S0.1.
});
