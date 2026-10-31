"use client";
import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Input, Textarea, Checkbox, Field, Select } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SocialAutopilotConfig } from "@/lib/db/schema";
import { generateAction, reschedulePostAction, saveAutopilotAction, saveConnectionAction, sendReplyAction, testConnectionAction, updatePostAction } from "./actions";

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
          <Field label="Your link (call to action)" htmlFor="link" hint="Replaces 👉 [Link] in every post. UTM tags are added per platform if enabled.">
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
        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium">Scheduling</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="When approved" htmlFor="scheduleMode">
              <Select id="scheduleMode" name="scheduleMode" defaultValue={config.scheduleMode}>
                <option value="slots">Publish at the next posting time</option>
                <option value="immediate">Publish immediately</option>
              </Select>
            </Field>
            <Field label="Posting times" htmlFor="postingTimes" hint="24h clock, comma-separated. Posts are spread across these slots.">
              <Input id="postingTimes" name="postingTimes" defaultValue={config.postingTimes.join(", ")} placeholder="09:00, 13:00, 20:00" />
            </Field>
            <Field label="Time zone" htmlFor="timezone">
              <Input id="timezone" name="timezone" defaultValue={config.timezone} placeholder="Asia/Dhaka" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium">Comments & replies</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Auto-reply to comments" htmlFor="autoReply" hint="Facebook, Instagram, Threads, Bluesky and Mastodon.">
              <Select id="autoReply" name="autoReply" defaultValue={config.autoReply}>
                <option value="approve">AI drafts replies, I approve</option>
                <option value="auto">AI replies automatically</option>
                <option value="off">Off (collect comments only)</option>
              </Select>
            </Field>
            <Field label="Max auto replies / 24h" htmlFor="maxRepliesPerDay">
              <Input id="maxRepliesPerDay" name="maxRepliesPerDay" type="number" min={1} max={200} defaultValue={config.maxRepliesPerDay} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium">Growth & SEO</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox name="rotateHooks" defaultChecked={config.rotateHooks} label="A/B test hooks: each platform gets a different hook" />
            <Checkbox name="threadMode" defaultChecked={config.threadMode} label="Post as a thread on Bluesky, Threads and Mastodon" />
            <Checkbox name="autoImage" defaultChecked={config.autoImage} label="Generate a branded image card for every post" />
            <Checkbox name="utm" defaultChecked={config.utm} label="Add UTM tags to my link (track clicks per platform)" />
          </div>
          <Field label="Brand colour (image cards)" htmlFor="brandColor" className="max-w-xs">
            <Input id="brandColor" name="brandColor" type="color" defaultValue={config.brandColor} className="h-9 w-20 p-1" />
          </Field>
        </fieldset>
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

export type EditablePost = {
  id: string;
  hook: string;
  hookVariants: string[];
  body: string;
  shortBody: string;
  platformTexts: Record<string, string>;
  thread: string[];
  engagementComment: string | null;
  hashtags: string[];
  primaryKeyword: string | null;
  altText: string | null;
  imageUrl: string | null;
  autoImage: boolean;
  platforms: string[];
};

export function EditPostDialog({ post, platforms }: { post: EditablePost; platforms: Option[] }) {
  const [state, act] = useActionState(updatePostAction, null);
  const f = (k: string) => `${k}-${post.id}`;
  return (
    <Dialog
      wide
      title="Edit post"
      description="Write {LINK} where your link should appear. The hook is placed above every text automatically."
      trigger={
        <Button size="sm" variant="ghost">
          Edit
        </Button>
      }
    >
      <form action={act} className="space-y-3">
        <input type="hidden" name="postId" value={post.id} />
        <Field label="Hook (headline)" htmlFor={f("hook")}>
          <Input id={f("hook")} name="hook" defaultValue={post.hook} maxLength={300} />
        </Field>
        <Field label="Hook variants for A/B tests" htmlFor={f("variants")} hint="One per line.">
          <Textarea id={f("variants")} name="hookVariants" rows={3} defaultValue={post.hookVariants.join("\n")} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="SEO keyword" htmlFor={f("kw")}>
            <Input id={f("kw")} name="primaryKeyword" defaultValue={post.primaryKeyword ?? ""} />
          </Field>
          <Field label="Hashtags" htmlFor={f("tags")}>
            <Input id={f("tags")} name="hashtags" defaultValue={post.hashtags.join(", ")} />
          </Field>
        </div>
        <Field label="Main text (Facebook, Telegram, Discord)" htmlFor={f("body")}>
          <Textarea id={f("body")} name="body" rows={6} defaultValue={post.body} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="LinkedIn version" htmlFor={f("li")} hint="Blank = use the main text.">
            <Textarea id={f("li")} name="linkedin" rows={5} defaultValue={post.platformTexts.linkedin ?? ""} />
          </Field>
          <Field label="Instagram caption" htmlFor={f("ig")} hint="Blank = use the main text.">
            <Textarea id={f("ig")} name="instagram" rows={5} defaultValue={post.platformTexts.instagram ?? ""} />
          </Field>
        </div>
        <Field label="Short text (Bluesky, Threads, Mastodon)" htmlFor={f("short")} hint="Keep under ~170 characters including {LINK}.">
          <Textarea id={f("short")} name="shortBody" rows={2} defaultValue={post.shortBody} maxLength={600} />
        </Field>
        <Field label="Thread follow-ups" htmlFor={f("thread")} hint="Separate parts with a line containing only ---">
          <Textarea id={f("thread")} name="thread" rows={4} defaultValue={post.thread.join("\n---\n")} />
        </Field>
        <Field label="Engagement comment" htmlFor={f("cmt")}>
          <Textarea id={f("cmt")} name="engagementComment" rows={2} defaultValue={post.engagementComment ?? ""} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Own image URL" htmlFor={f("img")} hint="Overrides the generated card.">
            <Input id={f("img")} name="imageUrl" type="url" defaultValue={post.imageUrl ?? ""} />
          </Field>
          <Field label="Image alt text (SEO + accessibility)" htmlFor={f("alt")}>
            <Input id={f("alt")} name="altText" defaultValue={post.altText ?? ""} />
          </Field>
        </div>
        <Checkbox name="autoImage" defaultChecked={post.autoImage} label="Use the generated image card when there is no own image" />
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

export function RescheduleForm({ postId, value }: { postId: string; value: string }) {
  const [state, act] = useActionState(reschedulePostAction, null);
  return (
    <form action={act} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="postId" value={postId} />
      <Input name="at" type="datetime-local" defaultValue={value} className="h-8 w-full min-w-0 px-2 text-xs" aria-label="New time" />
      <SubmitButton size="sm" variant="secondary" pendingText="…">
        Move
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ReplyForm({ commentId, replyText, disabled }: { commentId: string; replyText: string; disabled?: boolean }) {
  const [state, act] = useActionState(sendReplyAction, null);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="commentId" value={commentId} />
      <Textarea name="replyText" rows={2} defaultValue={replyText} placeholder="Write a reply…" disabled={disabled} aria-label="Reply" />
      <FormMessage state={state} />
      {!disabled ? (
        <SubmitButton size="sm" variant="primary" pendingText="Sending…">
          Send reply
        </SubmitButton>
      ) : null}
    </form>
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
