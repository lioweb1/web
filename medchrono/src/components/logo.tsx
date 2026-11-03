import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold text-ink">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy text-white">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 12h3l2-5 4 10 2-5h5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      MedChrono<span className="text-teal">AI</span>
    </Link>
  );
}
