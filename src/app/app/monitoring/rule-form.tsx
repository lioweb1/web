"use client";
import { useActionState, useState } from "react";
import { CountrySelector } from "@/components/ui/country-selector";
import { Field, Input, Select, Checkbox } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { saveRuleAction } from "./actions";

export type RuleFormValues = {
  ruleId?: string;
  name: string;
  providerIds: string[];
  countries: string[];
  cities: string[];
  industries: string[];
  businessTypes: string[];
  categories: string[];
  keyword: string;
  websiteState: "any" | "has_website" | "no_website";
  tlds: string[];
  minScore: number;
  contactRequirement: "none" | "email" | "phone" | "any";
  autoAnalyzeWebsites: boolean;
  autoTags: string[];
  autoListId: string | null;
  notify: boolean;
  frequency: "manual" | "hourly" | "daily" | "weekly" | "custom";
  customIntervalMinutes: number | null;
  active: boolean;
};

export function RuleForm({ values, providers, categories, lists }: { values: RuleFormValues; providers: { id: string; name: string; minInterval: number; status: string; supported: string }[]; categories: { id: string; label: string }[]; lists: { id: string; name: string }[] }) {
  const [state, act] = useActionState(saveRuleAction, null);
  const [sel, setSel] = useState(values.providerIds);
  const [freq, setFreq] = useState(values.frequency);
  const osm = sel.includes("osm");
  const crt = sel.includes("crtsh");
  return (
    <form action={act} className="space-y-6">
      {values.ruleId ? <input type="hidden" name="ruleId" value={values.ruleId} /> : null}
      <Card>
        <CardHeader title="Rule" />
        <CardBody className="space-y-4">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" defaultValue={values.name} required maxLength={120} placeholder="New dental practices in Berlin without a website" />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Data sources</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {providers.map((p) => (
                <label key={p.id} className="flex items-start gap-2 rounded-md border border-border p-2.5 text-sm">
                  <input type="checkbox" name="providerIds" value={p.id} checked={sel.includes(p.id)} onChange={(e) => setSel(e.currentTarget.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {p.supported} · min. interval {p.minInterval >= 60 ? `${p.minInterval / 60}h` : `${p.minInterval} min`} · {p.status}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Targeting criteria" description="Records with unknown values (e.g. no country) are kept and scored lower rather than dropped." />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label={osm ? "Country (OpenStreetMap needs exactly one)" : "Target countries"}>
            <CountrySelector name="countries" defaultValue={values.countries} />
          </Field>
          <Field label="Cities" htmlFor="cities" hint={osm ? "Required for OpenStreetMap. Comma-separated, up to 5." : "Comma-separated."}>
            <Input id="cities" name="cities" defaultValue={values.cities.join(", ")} />
          </Field>
          <Field label="Industries" htmlFor="industries" hint="Comma-separated, e.g. Healthcare, Construction. Used for matching and scoring.">
            <Input id="industries" name="industries" defaultValue={values.industries.join(", ")} />
          </Field>
          <Field label="Business types" htmlFor="businessTypes" hint="e.g. Local business, Private limited company, Startup / product">
            <Input id="businessTypes" name="businessTypes" defaultValue={values.businessTypes.join(", ")} />
          </Field>
          <Field label={crt ? "Keyword (required, 4+ letters, for Certificate Transparency)" : "Keyword"} htmlFor="keyword">
            <Input id="keyword" name="keyword" defaultValue={values.keyword} maxLength={80} />
          </Field>
          <Field label="Website" htmlFor="websiteState">
            <Select id="websiteState" name="websiteState" defaultValue={values.websiteState}>
              <option value="any">Any</option>
              <option value="no_website">No website listed</option>
              <option value="has_website">Has a website</option>
            </Select>
          </Field>
          {crt ? (
            <Field label="Domain extensions" htmlFor="tlds" hint="Comma-separated, e.g. com, de, co.uk">
              <Input id="tlds" name="tlds" defaultValue={values.tlds.join(", ")} />
            </Field>
          ) : (
            <input type="hidden" name="tlds" value={values.tlds.join(",")} />
          )}
          {osm ? (
            <fieldset className="md:col-span-2">
              <legend className="mb-2 text-sm font-medium">OpenStreetMap categories (none = all)</legend>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((c) => (
                  <Checkbox key={c.id} name="categories" value={c.id} label={c.label} defaultChecked={values.categories.includes(c.id)} />
                ))}
              </div>
            </fieldset>
          ) : (
            values.categories.map((c) => <input key={c} type="hidden" name="categories" value={c} />)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Qualification & actions" description="New businesses are enriched and scored first; only those meeting the threshold are saved as leads." />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Minimum lead score (0–100)" htmlFor="minScore">
            <Input id="minScore" name="minScore" type="number" min={0} max={100} defaultValue={values.minScore} />
          </Field>
          <Field label="Contact requirement" htmlFor="contactRequirement">
            <Select id="contactRequirement" name="contactRequirement" defaultValue={values.contactRequirement}>
              <option value="none">None</option>
              <option value="email">Business email available</option>
              <option value="phone">Business phone available</option>
              <option value="any">Email or phone</option>
            </Select>
          </Field>
          <Field label="Auto-tag new leads" htmlFor="autoTags" hint="Comma-separated tag names.">
            <Input id="autoTags" name="autoTags" defaultValue={values.autoTags.join(", ")} />
          </Field>
          <Field label="Add to list" htmlFor="autoListId">
            <Select id="autoListId" name="autoListId" defaultValue={values.autoListId ?? ""}>
              <option value="">No list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Checkbox name="autoAnalyzeWebsites" defaultChecked={values.autoAnalyzeWebsites} label="Analyze websites of new businesses before scoring" />
            <Checkbox name="notify" defaultChecked={values.notify} label="Notify me about qualifying leads (respects your notification preferences)" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Schedule" description="Intervals are never shorter than each source's permitted refresh rate. All sources are periodic — this is scheduled checking, not real-time streaming." />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <Field label="Frequency" htmlFor="frequency">
            <Select id="frequency" name="frequency" value={freq} onChange={(e) => setFreq(e.currentTarget.value as RuleFormValues["frequency"])}>
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly (where provider limits permit)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="custom">Custom interval</option>
            </Select>
          </Field>
          {freq === "custom" ? (
            <Field label="Interval (minutes, min. 15)" htmlFor="customIntervalMinutes">
              <Input id="customIntervalMinutes" name="customIntervalMinutes" type="number" min={15} max={43200} defaultValue={values.customIntervalMinutes ?? 360} />
            </Field>
          ) : null}
          <Checkbox name="active" defaultChecked={values.active} label="Active" className="md:col-span-2" />
        </CardBody>
      </Card>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">{values.ruleId ? "Save changes" : "Create rule"}</SubmitButton>
    </form>
  );
}
