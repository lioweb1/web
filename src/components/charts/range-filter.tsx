import Link from "next/link";
import { CountrySelector } from "@/components/ui/country-selector";
import { Select, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Date-range + market filter row (plain GET form, so the state lives in the URL). */
export function RangeFilter({
  action,
  preset,
  from,
  to,
  countries,
  markets,
}: {
  action: string;
  preset: string;
  from: Date;
  to: Date;
  countries: string[];
  markets: { id: string; name: string; countries: string[]; mode: string }[];
}) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-3 shadow-card">
      <form action={action} method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="range" className="block text-xs font-medium text-muted">
            Date range
          </label>
          <Select id="range" name="range" defaultValue={preset} className="w-40">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="from" className="block text-xs font-medium text-muted">
            From (custom)
          </label>
          <Input id="from" name="from" type="date" defaultValue={from.toISOString().slice(0, 10)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="block text-xs font-medium text-muted">
            To (custom)
          </label>
          <Input id="to" name="to" type="date" defaultValue={to.toISOString().slice(0, 10)} className="w-40" />
        </div>
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor="country-filter" className="block text-xs font-medium text-muted">
            Market
          </label>
          <CountrySelector id="country-filter" name="country" defaultValue={countries} />
        </div>
        <Button type="submit" variant="primary">
          Apply
        </Button>
      </form>
      {markets.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Saved markets:</span>
          {markets.map((m) => (
            <Link key={m.id} href={`${action}?range=${preset}&country=${m.mode === "all" ? "" : m.countries.join(",")}`} className="rounded-full border border-border px-2 py-0.5 text-fg hover:bg-surface-2">
              {m.name}
            </Link>
          ))}
          <Link href={`${action}?range=${preset}`} className="rounded-full border border-border px-2 py-0.5 text-fg hover:bg-surface-2">
            All countries
          </Link>
        </div>
      ) : null}
    </div>
  );
}
