import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedChrono AI — Medical chronologies in an hour, not ten days",
  description:
    "Turn thousands of pages of medical records into a page-cited chronology, treatment-gap analysis, medical specials summary and missing-records requests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
