/**
 * CI assertion — architecture §5.4 "SupportedEntityTable".
 *
 * Fails the build if the TypeScript `SupportedEntityTable` union in
 * lib/events/emit.ts diverges from the plpgsql ELSIF ladder in the
 * emit_event_atomic migration. Stage 0 placeholder — real enforcement
 * lands in S0.3 when emit.ts ships.
 */

function main(): void {
  // eslint-disable-next-line no-console
  console.log('[assert-entity-table-sync] placeholder — S0.3 wires real check. OK.');
}

main();
