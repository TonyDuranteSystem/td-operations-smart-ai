import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Admin layout shell — architecture §5.1 event-log inspector + future admin
 * surfaces. Stage 0 has no auth gate (events table empty → no PII risk
 * today). **Gate before S0.7 ships shadow-mode v1-clone data** — see
 * `dev_task 2bc839aa` progress_log.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="text-lg font-semibold tracking-tight">
            Smart AI <span className="text-zinc-400">/</span> Admin
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/events" className="text-zinc-600 hover:text-zinc-900">
              Events
            </Link>
            <Link href="/admin/shadow-diffs" className="text-zinc-600 hover:text-zinc-900">
              Shadow diffs
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-zinc-400">
        Stage 0 admin surface · no auth yet · do not ship beyond dev/staging
      </footer>
    </div>
  );
}
