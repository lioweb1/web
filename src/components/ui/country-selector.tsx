"use client";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Globe2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { COUNTRIES, COUNTRY_GROUPS, flag, countryName } from "@/lib/countries";
import { cn } from "./cn";

/**
 * Searchable country picker. Supports every ISO 3166 country, group presets (Premium
 * Markets, regions, …), "All countries" and single-select mode. Submits a hidden input
 * with comma-separated ISO codes ("" = all countries).
 */
export function CountrySelector({
  name,
  defaultValue = [],
  single = false,
  allowAll = true,
  placeholder = "Select countries",
  id,
  onChange,
}: {
  name: string;
  defaultValue?: string[];
  single?: boolean;
  allowAll?: boolean;
  placeholder?: string;
  id?: string;
  onChange?: (codes: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(defaultValue);
  const [open, setOpen] = useState(false);
  const set = (codes: string[]) => {
    setSelected(codes);
    onChange?.(codes);
  };
  const toggle = (code: string) => {
    if (single) {
      set([code]);
      setOpen(false);
      return;
    }
    set(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };
  const label = useMemo(() => {
    if (!selected.length) return allowAll && !single ? "All countries" : placeholder;
    const group = COUNTRY_GROUPS.find((g) => g.codes.length === selected.length && g.codes.every((c) => selected.includes(c)));
    if (group && !single) return group.name;
    if (selected.length <= 3) return selected.map((c) => `${flag(c)} ${countryName(c)}`).join(", ");
    return `${selected.length} countries`;
  }, [selected, allowAll, single, placeholder]);

  return (
    <div>
      <input type="hidden" name={name} value={selected.join(",")} />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-left text-sm shadow-card hover:border-border-strong"
          >
            <span className={cn("truncate", !selected.length && !(allowAll && !single) && "text-subtle")}>
              <Globe2 className="mr-1.5 inline size-4 text-muted" />
              {label}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface shadow-xl">
            <Command loop>
              <Command.Input placeholder="Search countries or groups…" className="h-10 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-subtle" />
              <Command.List className="max-h-80 overflow-y-auto p-1">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No country found.</Command.Empty>
                {!single ? (
                  <Command.Group heading="Presets" className="px-1 text-xs text-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {allowAll ? (
                      <Item value="all countries" onSelect={() => set([])} checked={!selected.length}>
                        All countries
                      </Item>
                    ) : null}
                    {COUNTRY_GROUPS.map((g) => {
                      const all = g.codes.every((c) => selected.includes(c));
                      return (
                        <Item key={g.id} value={`group ${g.name}`} onSelect={() => set(all ? selected.filter((c) => !g.codes.includes(c)) : Array.from(new Set([...selected, ...g.codes])))} checked={all && selected.length > 0}>
                          {g.name} <span className="ml-auto text-xs text-subtle">{g.codes.length}</span>
                        </Item>
                      );
                    })}
                  </Command.Group>
                ) : null}
                <Command.Group heading="Countries" className="px-1 text-xs text-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {COUNTRIES.map((c) => (
                    <Item key={c.code} value={`${c.name} ${c.native} ${c.code}`} onSelect={() => toggle(c.code)} checked={selected.includes(c.code)}>
                      <span aria-hidden>{flag(c.code)}</span> {c.name} <span className="ml-auto text-xs text-subtle">{c.region}</span>
                    </Item>
                  ))}
                </Command.Group>
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {!single && selected.length > 0 && selected.length <= 24 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg">
              {flag(c)} {c}
              <button type="button" aria-label={`Remove ${countryName(c)}`} onClick={() => toggle(c)} className="text-muted hover:text-fg">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Item({ value, onSelect, checked, children }: { value: string; onSelect: () => void; checked: boolean; children: React.ReactNode }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg data-[selected=true]:bg-surface-2">
      <Check className={cn("size-4 shrink-0 text-accent", checked ? "opacity-100" : "opacity-0")} />
      {children}
    </Command.Item>
  );
}
