import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { ImportWizard } from "@/components/crm/import-wizard";
import { importCsvAction } from "../actions";

export const metadata = { title: "Import leads" };

export default async function ImportPage() {
  await requireRole("member");
  return (
    <>
      <Link href="/app/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Leads
      </Link>
      <PageHeader title="Import leads from CSV" description="Bring in your own prospect lists. Records are deduplicated, kept private to this workspace, and can be enriched with website and domain intelligence." />
      <Card>
        <CardBody>
          <ImportWizard action={importCsvAction} />
        </CardBody>
      </Card>
    </>
  );
}
