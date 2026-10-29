import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted">The page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/app/dashboard" className="mt-4 text-sm text-accent hover:underline">
        Go to dashboard
      </Link>
    </main>
  );
}
