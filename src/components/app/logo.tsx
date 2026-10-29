export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-fg">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <circle cx="16" cy="16" r="5" fill="var(--accent)" />
        <ellipse cx="16" cy="16" rx="13" ry="6.5" fill="none" stroke="var(--accent)" strokeWidth="2" transform="rotate(-25 16 16)" opacity="0.55" />
      </svg>
      {compact ? null : (
        <span>
          LeadOrbit <span className="text-accent">AI</span>
        </span>
      )}
    </span>
  );
}
