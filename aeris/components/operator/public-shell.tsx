import Link from 'next/link';

interface PublicShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function OperatorPublicShell({ title, subtitle, children }: PublicShellProps) {
  return (
    <div className="min-h-screen bg-navy">
      <header className="border-b border-border bg-navy-secondary/85">
        <div className="mx-auto flex max-w-7xl items-center px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Aeris">
            <span className="font-display text-xl tracking-[0.28em] text-gold-light">AERIS</span>
            <span className="font-ar rounded-full border border-border px-2.5 py-0.5 text-xs uppercase tracking-tagged text-ink-muted">
              بوابة المشغّلين
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 text-center">
          <h1 className="font-ar text-2xl text-ink-primary">{title}</h1>
          {subtitle ? (
            <p className="font-ar mt-2 text-sm text-ink-muted">{subtitle}</p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-border bg-navy-card/40 p-6 sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
