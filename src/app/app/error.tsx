"use client";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-12">
      <ErrorState
        title="This page could not be loaded"
        description={
          <>
            <p>{process.env.NODE_ENV === "development" ? error.message : "An unexpected error occurred. It has been logged."}</p>
            {error.digest ? <p className="mt-1 text-xs text-muted">Reference: {error.digest}</p> : null}
          </>
        }
        action={
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
