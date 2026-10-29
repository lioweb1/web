"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { CountrySelector } from "@/components/ui/country-selector";
import { Field, Input, Select, Checkbox } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { startDiscoveryAction } from "./actions";

export type ProviderOption = {
  id: string;
  name: string;
  description: string;
  criteriaSupport: string[];
  supportedCountries: "all" | string[];
  pricingNote: string;
  refreshNote: string;
  enabled: boolean;
  configured: boolean;
};

export function DiscoverForm({ providers, categories, defaultCountries, initialProvider, canRun }: { providers: ProviderOption[]; categories: { id: string; label: string }[]; defaultCountries: string[]; initialProvider: string; canRun: boolean }) {
  const [state, act] = useActionState(startDiscoveryAction, null);
  const [providerId, setProviderId] = useState(initialProvider);
  const p = providers.find((x) => x.id === providerId) ?? providers[0];
  const supports = (k: string) => p.criteriaSupport.includes(k);
  const single = p.id === "osm";
  const countryDefault = Array.isArray(p.supportedCountries) ? p.supportedCountries : single ? defaultCountries.slice(0, 1) : defaultCountries;
  const ready = p.enabled && p.configured;

  return (
    <form action={act} className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Data source</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((x) => (
            <label key={x.id} className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors ${x.id === providerId ? "border-accent bg-accent-soft/50" : "border-border hover:border-border-strong"}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name="providerId" value={x.id} checked={x.id === providerId} onChange={() => setProviderId(x.id)} className="accent-[var(--accent)]" />
                <span className="font-medium">{x.name}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted">{x.description}</span>
              <span className="flex min-w-0 flex-wrap gap-1">
                <Badge tone="outline">{x.supportedCountries === "all" ? "Any country" : `Only ${x.supportedCountries.join(", ")}`}</Badge>
                {!x.enabled ? <Badge tone="warning">Disabled</Badge> : !x.configured ? <Badge tone="warning">Needs setup</Badge> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-md bg-surface-2/70 px-3 py-2 text-xs text-muted">
        <p>{p.pricingNote}</p>
        <p className="mt-0.5">{p.refreshNote}</p>
        {!ready ? (
          <p className="mt-1 text-warning">
            This source is {p.enabled ? "not configured" : "disabled"}.{" "}
            <Link href="/app/integrations" className="underline">
              Configure it on the Data sources page
            </Link>
            .
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2" key={p.id}>
        {supports("countries") ? (
          <Field label={single ? "Country" : "Countries"} hint={single ? "OpenStreetMap searches one country at a time." : "Records without a known country are kept and scored lower."}>
            <CountrySelector name="countries" single={single} allowAll={!single} defaultValue={countryDefault} />
          </Field>
        ) : (
          <input type="hidden" name="countries" value={Array.isArray(p.supportedCountries) ? p.supportedCountries.join(",") : ""} />
        )}
        {supports("cities") ? (
          <Field label={single ? "Cities (required)" : "City"} htmlFor="cities" hint={single ? "Comma-separated, up to 5. Use official names, e.g. München." : "Companies House supports one location per search."}>
            <Input id="cities" name="cities" placeholder={single ? "Berlin, Hamburg" : "Leeds"} required={single} />
          </Field>
        ) : null}
        {supports("keyword") ? (
          <Field label={p.id === "crtsh" ? "Keyword in domain (required)" : "Keyword"} htmlFor="keyword" hint={p.id === "crtsh" ? "At least 4 letters, e.g. bakery, dental, roofing." : p.id === "companies_house" ? "Matches company names." : "Matches business names / post text."}>
            <Input id="keyword" name="keyword" maxLength={80} required={p.id === "crtsh"} minLength={p.id === "crtsh" ? 4 : undefined} />
          </Field>
        ) : null}
        {supports("tlds") ? (
          <Field label="Domain extensions" htmlFor="tlds" hint="Comma-separated, up to 5 (e.g. com, co.uk, de).">
            <Input id="tlds" name="tlds" defaultValue="com" />
          </Field>
        ) : null}
        {supports("websiteState") ? (
          <Field label="Website" htmlFor="websiteState">
            <Select id="websiteState" name="websiteState" defaultValue="any">
              <option value="any">Any</option>
              <option value="no_website">No website listed</option>
              <option value="has_website">Has a website</option>
            </Select>
          </Field>
        ) : null}
      </div>
      {supports("categories") ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Business categories <span className="font-normal text-muted">(none selected = all)</span></legend>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => (
              <Checkbox key={c.id} name="categories" value={c.id} label={c.label} />
            ))}
          </div>
        </fieldset>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton disabled={!ready || !canRun} pendingText="Queuing…">
        Run discovery
      </SubmitButton>
      {!canRun ? <p className="text-xs text-muted">Viewers cannot run discovery.</p> : null}
    </form>
  );
}
