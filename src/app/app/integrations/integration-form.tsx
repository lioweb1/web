"use client";
import { useActionState } from "react";
import { Input, Textarea, Checkbox, Field } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { saveIntegrationAction, testIntegrationAction } from "./actions";

export type FieldView = { key: string; label: string; type: "secret" | "text" | "textarea" | "checkbox"; help?: string; required?: boolean };

export function IntegrationForm({
  providerId,
  enabled,
  settingFields,
  secretFields,
  settings,
  masked,
  canEdit,
  hasTest,
}: {
  providerId: string;
  enabled: boolean;
  settingFields: FieldView[];
  secretFields: FieldView[];
  settings: Record<string, string>;
  masked: Record<string, string | null>;
  canEdit: boolean;
  hasTest: boolean;
}) {
  const [saveState, save] = useActionState(saveIntegrationAction, null);
  const [testState, test] = useActionState(testIntegrationAction, null);
  return (
    <div className="space-y-3">
      <form action={save} className="space-y-3">
        <input type="hidden" name="providerId" value={providerId} />
        <fieldset disabled={!canEdit} className="space-y-3">
          <Checkbox name="enabled" defaultChecked={enabled} label="Enabled" />
          {secretFields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`${providerId}-${f.key}`} hint={f.help}>
              <Input id={`${providerId}-${f.key}`} name={`secret_${f.key}`} type="password" autoComplete="off" placeholder={masked[f.key] ? `Saved (${masked[f.key]}) — leave blank to keep` : "Not set"} />
              {masked[f.key] ? <Checkbox name={`secret_${f.key}__clear`} label={<span className="text-xs text-muted">Remove saved value</span>} /> : null}
            </Field>
          ))}
          {settingFields.map((f) =>
            f.type === "checkbox" ? (
              <Checkbox key={f.key} name={`setting_${f.key}`} defaultChecked={settings[f.key] === "1"} label={f.label} />
            ) : (
              <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`${providerId}-s-${f.key}`} hint={f.help}>
                {f.type === "textarea" ? (
                  <Textarea id={`${providerId}-s-${f.key}`} name={`setting_${f.key}`} defaultValue={settings[f.key] ?? ""} rows={4} />
                ) : (
                  <Input id={`${providerId}-s-${f.key}`} name={`setting_${f.key}`} defaultValue={settings[f.key] ?? ""} />
                )}
              </Field>
            ),
          )}
        </fieldset>
        <FormMessage state={saveState} />
        {canEdit ? (
          <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
            Save
          </SubmitButton>
        ) : (
          <p className="text-xs text-muted">Only workspace admins can change data source settings.</p>
        )}
      </form>
      {hasTest && canEdit ? (
        <form action={test} className="space-y-2">
          <input type="hidden" name="providerId" value={providerId} />
          <SubmitButton size="sm" variant="primary" pendingText="Testing…">
            Test connection
          </SubmitButton>
          <FormMessage state={testState} />
        </form>
      ) : null}
    </div>
  );
}
