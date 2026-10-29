"use client";
import { useActionState, useEffect, useState } from "react";
import { Input, Select, Checkbox, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { CountrySelector } from "@/components/ui/country-selector";
import type { NotificationPrefsShape } from "@/lib/db/schema";
import { savePrefsAction } from "./actions";

export function PrefsForm({ prefs, types, smtp }: { prefs: NotificationPrefsShape; types: Record<string, string>; smtp: boolean }) {
  const [state, act] = useActionState(savePrefsAction, null);
  const [perm, setPerm] = useState<string>("unsupported");
  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);
  return (
    <form action={act} className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Notify me about</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(types).map(([k, label]) => (
            <Checkbox key={k} name="types" value={k} defaultChecked={prefs.types[k] !== false} label={label} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum lead score" htmlFor="minScore" hint="Lead alerts below this score are skipped.">
          <Input id="minScore" name="minScore" type="number" min={0} max={100} defaultValue={prefs.minScore} />
        </Field>
        <Field label="Only these countries" htmlFor="countries" hint="Leave as 'All countries' to receive every market.">
          <CountrySelector id="countries" name="countries" defaultValue={prefs.countries} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email" hint={smtp ? "Uses the server's SMTP settings." : "SMTP is not configured on this server, so emails are not sent. Set SMTP_HOST and SMTP_FROM (a free Gmail/Brevo SMTP account works)."}>
          <Select id="email" name="email" defaultValue={prefs.email}>
            <option value="off">Off</option>
            <option value="immediate">Immediately (respects quiet hours)</option>
            <option value="daily">Daily summary</option>
          </Select>
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">Browser notifications</p>
          <Checkbox name="browser" defaultChecked={prefs.browser} label="Show desktop notifications while LeadOrbit is open" />
          {perm === "granted" ? (
            <p className="text-xs text-success">Permission granted in this browser.</p>
          ) : perm === "denied" ? (
            <p className="text-xs text-muted">Blocked in browser settings. Allow notifications for this site to enable them.</p>
          ) : perm === "default" ? (
            <Button type="button" size="sm" onClick={() => Notification.requestPermission().then(setPerm)}>
              Enable browser notifications
            </Button>
          ) : (
            <p className="text-xs text-muted">This browser does not support notifications.</p>
          )}
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Quiet hours</legend>
        <Checkbox name="quietEnabled" defaultChecked={prefs.quietHours.enabled} label="Delay immediate emails during quiet hours (in-app notifications still appear)" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start" htmlFor="quietStart">
            <Input id="quietStart" name="quietStart" type="time" defaultValue={prefs.quietHours.start} />
          </Field>
          <Field label="End" htmlFor="quietEnd">
            <Input id="quietEnd" name="quietEnd" type="time" defaultValue={prefs.quietHours.end} />
          </Field>
          <Field label="Time zone" htmlFor="timezone" hint="IANA name, e.g. Asia/Dhaka">
            <Input id="timezone" name="timezone" defaultValue={prefs.quietHours.timezone} />
          </Field>
        </div>
      </fieldset>
      <p className="text-xs text-muted">Duplicate alerts for the same event are always suppressed.</p>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save preferences</SubmitButton>
    </form>
  );
}
