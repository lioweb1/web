"use client";
import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Input, Textarea, Checkbox, Field, Select } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SocialAutopilotConfig } from "@/lib/db/schema";
import { generateAction, saveAutopilotAction, saveConnectionAction, testConnectionAction, updatePostAction } from "./actions";

type FieldView = { key: string; label: string; type: "secret" | "text" | "textarea" | "checkbox"; help?: string; required?: boolean };
type Option = { id: string; name: string; note?: string; status?: string };

export function ConnectionForm({ kind, id, enabled, settingFields, secretFields, settings, masked, canEdit }: { kind: "ai" | "platform"; id: string; enabled: boolean; settingFields: FieldView[]; secretFields: FieldView[]; settings: Record<string, string>; masked: Record<string, string | null>; canEdit: boolean }) {
  const [saveState, save] = useActionState(saveConnectionAction, null);
  const [testState, test] = useActionState(testConnectionAction, null);
  return (
    <div className="space-y-3">
      <form action={save} className="space-y-3">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <fieldset disabled={!canEdit} className="space-y-3">
          {kind === "platform" ? <Checkbox name="enabled" defaultChecked={enabled} label="Enabled" /> : null}
          {secretFields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`${id}-${f.key}`} hint={f.help}>
              <Input id={`${id}-${f.key}`} name={`secret_${f.key}`} type="password" autoComplete="off" placeholder={masked[f.key] ? `Saved (${masked[f.key]}) — leave blank to keep` : "Not set"} />
              {masked[f.key] ? <Checkbox name={`secret_${f.key}__clear`} label={<span className="text-xs text-muted">Remove saved value</span>} /> : null}
            </Field>
          ))}
          {settingFields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`${id}-s-${f.key}`} hint={f.help}>
              <Input id={`${id}-s-${f.key}`} name={`setting_${f.key}`} defaultValue={settings[f.key] ?? ""} />
            </Field>
          ))}
        </fieldset>
        <FormMessage state={saveState} />
        {canEdit ? (
          <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
            Save
          </SubmitButton>
        ) : (
          <p className="text-xs text-muted">Only workspace admins can change connections.</p>
        )}
      </form>
      {canEdit ? (
        <form action={test} className="space-y-2">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <SubmitButton size="sm" variant="primary" pendingText="Testing…">
            Test connection
          </SubmitButton>
          <FormMessage state={testState} />
        </form>
      ) : null}
    </div>
  );
}

export function AutopilotForm({ active, intervalMinutes, config, sources, platforms, aiProviders, canEdit }: { active: boolean; intervalMinutes: number; config: SocialAutopilotConfig; sources: Option[]; platforms: Option[]; aiProviders: Option[]; canEdit: boolean }) {
  const [state, act] = useActionState(saveAutopilotAction, null);
  const [mode, setMode] = useState(config.mode);
  const [src, setSrc] = useState(config.sources);
  return (
    <form action={act} className="space-y-5">
      <fieldset disabled={!canEdit} className="space-y-5">
        <Checkbox name="active" defaultChecked={active} label={<span className="font-medium">Autopilot on: scan for trends on a schedule</span>} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Niche keywords *" htmlFor="keywords" hint="One per line or comma-separated. A trend must mention one of these.">
            <Textarea id="keywords" name="keywords" rows={3} defaultValue={config.keywords.join("\n")} placeholder={"web design\nfreelancing\nAI tools"} />
          </Field>
          <Field label="Brand voice / what you sell" htmlFor="brandVoice" hint="The AI uses this to mention your brand naturally.">
            <Textarea id="brandVoice" name="brandVoice" rows={3} defaultValue={config.brandVoice} placeholder="LeadOrbit AI finds and scores leads for web agencies using free, official data sources." />
          </Field>
          <Field label="Brand name" htmlFor="brandName">
            <Input id="brandName" name="brandName" defaultValue={config.brandName} placeholder="LeadOrbit AI" />
          </Field>
          <Field label="Your link (call to action)" htmlFor="link" hint="Replaces 👉 [Link] in every post.">
            <Input id="link" name="link" type="url" defaultValue={config.link} placeholder="https://example.com" />
          </Field>
          <Field label="Post language" htmlFor="language">
            <Input id="language" name="language" defaultValue={config.language} placeholder="English, Bangla, Banglish…" />
          </Field>
          <Field label="AI writer" htmlFor="aiProvider" hint="Configure its key under Connections below.">
            <Select id="aiProvider" name="aiProvider" defaultValue={config.aiProvider}>
              {aiProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.status ? ` — ${p.status}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Where to find trends</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {sources.map((s) => (
              <Checkbox
                key={s.id}
                name="sources"
                value={s.id}
                checked={src.includes(s.id)}
                onChange={(e) => setSrc((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))}
                label={
                  <span>
                    {s.name} <span className="text-xs text-muted">· {s.note}</span>
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
        {src.includes("reddit") ? (
          <Field label="Subreddits" htmlFor="subreddits" hint="Optional. Without subreddits, Reddit is searched for your keywords.">
            <Input id="subreddits" name="subreddits" defaultValue={config.subreddits.join(", ")} placeholder="webdev, freelance, smallbusiness" />
          </Field>
        ) : (
          <input type="hidden" name="subreddits" value={config.subreddits.join(",")} />
        )}
        {src.includes("rss") ? (
          <Field label="RSS feed URLs" htmlFor="feeds" hint="One per line.">
            <Textarea id="feeds" name="feeds" rows={3} defaultValue={config.feeds.join("\n")} />
          </Field>
        ) : (
          <input type="hidden" name="feeds" value={config.feeds.join("\n")} />
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Post to</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {platforms.map((p) => (
              <Checkbox key={p.id} name="platforms" value={p.id} defaultChecked={config.platforms.includes(p.id)} label={<span>{p.name} {p.status ? <span className="text-xs text-muted">· {p.status}</span> : null}</span>} />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Publishing" htmlFor="mode">
            <Select id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value as "approve" | "auto")}>
              <option value="approve">Approve each post first</option>
              <option value="auto">Fully automatic</option>
            </Select>
          </Field>
          <Field label="Scan every" htmlFor="intervalMinutes">
            <Select id="intervalMinutes" name="intervalMinutes" defaultValue={String(intervalMinutes)}>
              {[30, 60, 120, 180, 360, 720, 1440].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : m === 60 ? "hour" : m === 1440 ? "day" : `${m / 60} hours`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Drafts per scan" htmlFor="draftsPerScan">
            <Input id="draftsPerScan" name="draftsPerScan" type="number" min={1} max={10} defaultValue={config.draftsPerScan} />
          </Field>
          <Field label="Max auto posts / 24h" htmlFor="maxPostsPerDay" hint="Keeps accounts from looking like spam.">
            <Input id="maxPostsPerDay" name="maxPostsPerDay" type="number" min={1} max={20} defaultValue={config.maxPostsPerDay} />
          </Field>
        </div>
        {mode === "auto" ? <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">Fully automatic posts go out without review. Start with approval mode until you like the AI&apos;s output, and keep the daily limit low.</p> : null}
      </fieldset>
      <FormMessage state={state} />
      {canEdit ? (
        <SubmitButton variant="primary" pendingText="Saving…">
          Save autopilot
        </SubmitButton>
      ) : (
        <p className="text-xs text-muted">Only workspace admins can change autopilot settings.</p>
      )}
    </form>
  );
}

export function GenerateForm({ platforms, defaultPlatforms }: { platforms: Option[]; defaultPlatforms: string[] }) {
  const [state, act] = useActionState(generateAction, null);
  return (
    <form action={act} className="space-y-3">
      <Field label="Paste a post, keywords or an idea" htmlFor="gen-text">
        <Textarea id="gen-text" name="text" rows={4} required placeholder="Finding clients as a freelance web dev is exhausting. Cold DMs aren't working anymore." />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Source URL (optional)" htmlFor="gen-url">
          <Input id="gen-url" name="url" type="url" />
        </Field>
        <Field label="Image URL (optional, needed for Instagram)" htmlFor="gen-img">
          <Input id="gen-img" name="imageUrl" type="url" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {platforms.map((p) => (
          <Checkbox key={p.id} name="platforms" value={p.id} defaultChecked={defaultPlatforms.includes(p.id)} label={p.name} />
        ))}
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="primary" pendingText="Writing…">
        Generate post
      </SubmitButton>
    </form>
  );
}

export type EditablePost = { id: string; hook: string; body: string; shortBody: string; engagementComment: string | null; hashtags: string[]; imageUrl: string | null; platforms: string[] };

export function EditPostDialog({ post, platforms }: { post: EditablePost; platforms: Option[] }) {
  const [state, act] = useActionState(updatePostAction, null);
  return (
    <Dialog
      wide
      title="Edit post"
      description="Write {LINK} where your link should appear."
      trigger={
        <Button size="sm" variant="ghost">
          Edit
        </Button>
      }
    >
      <form action={act} className="space-y-3">
        <input type="hidden" name="postId" value={post.id} />
        <Field label="Hook" htmlFor={`hook-${post.id}`}>
          <Input id={`hook-${post.id}`} name="hook" defaultValue={post.hook} maxLength={300} />
        </Field>
        <Field label="Full post (Facebook, Instagram, LinkedIn, Telegram, Discord)" htmlFor={`body-${post.id}`}>
          <Textarea id={`body-${post.id}`} name="body" rows={8} defaultValue={post.body} />
        </Field>
        <Field label="Short post (Bluesky, Threads, Mastodon)" htmlFor={`short-${post.id}`} hint="Keep under ~240 characters including the link.">
          <Textarea id={`short-${post.id}`} name="shortBody" rows={3} defaultValue={post.shortBody} maxLength={600} />
        </Field>
        <Field label="Engagement comment" htmlFor={`cmt-${post.id}`}>
          <Textarea id={`cmt-${post.id}`} name="engagementComment" rows={2} defaultValue={post.engagementComment ?? ""} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Hashtags" htmlFor={`tags-${post.id}`}>
            <Input id={`tags-${post.id}`} name="hashtags" defaultValue={post.hashtags.join(", ")} />
          </Field>
          <Field label="Image URL" htmlFor={`img-${post.id}`}>
            <Input id={`img-${post.id}`} name="imageUrl" type="url" defaultValue={post.imageUrl ?? ""} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {platforms.map((p) => (
            <Checkbox key={p.id} name="platforms" value={p.id} defaultChecked={post.platforms.includes(p.id)} label={p.name} />
          ))}
        </div>
        <FormMessage state={state} />
        <SubmitButton variant="primary" pendingText="Saving…">
          Save changes
        </SubmitButton>
      </form>
    </Dialog>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : label}
    </Button>
  );
}
