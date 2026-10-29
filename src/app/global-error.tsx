"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", padding: 40 }}>
        <h1>Something went wrong</h1>
        <p>An unexpected error occurred. No details are shown for security reasons.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
