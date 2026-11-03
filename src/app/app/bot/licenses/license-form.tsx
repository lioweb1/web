import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Checkbox, Textarea } from "@/components/ui/input";
import { createLicenseAction } from "./actions";

export function LicenseForm() {
  return (
    <ActionForm action={createLicenseAction} submitLabel="Create license" pendingText="Creating…">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" htmlFor="label" hint="Customer name or order reference.">
          <Input id="label" name="label" required maxLength={120} placeholder="e.g. John D. — order 1042" />
        </Field>
        <Field label="Plan" htmlFor="plan">
          <Select id="plan" name="plan" defaultValue="monthly">
            <option value="trial">Trial (7 days)</option>
            <option value="monthly">Monthly (30 days)</option>
            <option value="yearly">Yearly (365 days)</option>
            <option value="lifetime">Lifetime</option>
          </Select>
        </Field>
        <Field label="Expiry" htmlFor="expiry" hint="“From plan” uses the plan's duration from today.">
          <Select id="expiry" name="expiry" defaultValue="plan">
            <option value="plan">From plan</option>
            <option value="custom">Custom date</option>
            <option value="never">Never</option>
          </Select>
        </Field>
        <Field label="Custom expiry date" htmlFor="expiresAt">
          <Input id="expiresAt" name="expiresAt" type="date" />
        </Field>
        <Field label="Max devices" htmlFor="maxDevices" hint="Machines that may run this key at the same time.">
          <Input id="maxDevices" name="maxDevices" type="number" min={1} max={50} defaultValue={1} />
        </Field>
        <Field label="Max symbols" htmlFor="maxSymbols" hint="Assets the bot may scan at once.">
          <Input id="maxSymbols" name="maxSymbols" type="number" min={1} max={50} defaultValue={5} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg">Features</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="autoTrade" label="Auto trade (otherwise signals only)" defaultChecked />
          <Checkbox name="copier" label="Telegram signal copier" />
          <Checkbox name="extension" label="Chrome extension" defaultChecked />
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg">Brokers</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="brokers" value="paper" label="Paper" defaultChecked />
          <Checkbox name="brokers" value="deriv" label="Deriv (official API)" defaultChecked />
          <Checkbox name="brokers" value="browser" label="Browser (Pocket Option, Quotex, …)" defaultChecked />
          <Checkbox name="brokers" value="extension" label="Extension" defaultChecked />
        </div>
      </fieldset>
      <Field label="Notes" htmlFor="notes" hint="Internal only; never sent to the bot.">
        <Textarea id="notes" name="notes" maxLength={2000} placeholder="Payment reference, Telegram handle…" />
      </Field>
    </ActionForm>
  );
}
