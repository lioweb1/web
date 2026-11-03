"use client";
import { useActionState, useRef, useState } from "react";
import { ExternalLink, ImagePlus, Loader2, X } from "lucide-react";
import { Input, Textarea, Checkbox, Field } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { composeAction } from "../actions";

type Option = { id: string; name: string; connected: boolean; note?: string };
type Upload = { key: string; id?: string; url?: string; preview: string; alt: string; error?: string; uploading: boolean };

const SHORT_LIMITS: Record<string, number> = { bluesky: 300, threads: 500, mastodon: 500 };
const MAX_IMAGES = 10;

export function ComposeForm({ platforms, defaultPlatforms, scheduleLabel }: { platforms: Option[]; defaultPlatforms: string[]; scheduleLabel: string | null }) {
  const [state, act] = useActionState(composeAction, null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  // Controlled so a failed publish keeps everything for a retry (React resets uncontrolled fields).
  const [link, setLink] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [selected, setSelected] = useState(defaultPlatforms);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uploading = uploads.some((u) => u.uploading);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_IMAGES - uploads.length;
    const picked = Array.from(files).slice(0, room);
    const items: Upload[] = picked.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, preview: URL.createObjectURL(f), alt: "", uploading: true }));
    setUploads((u) => [...u, ...items]);
    await Promise.all(
      picked.map(async (file, i) => {
        const fd = new FormData();
        fd.append("file", file);
        let patch: Partial<Upload>;
        try {
          const res = await fetch("/api/social/upload", { method: "POST", body: fd });
          const json = (await res.json()) as { id?: string; url?: string; error?: string };
          patch = res.ok && json.id ? { id: json.id, url: json.url, uploading: false } : { error: json.error ?? "Upload failed", uploading: false };
        } catch {
          patch = { error: "Upload failed", uploading: false };
        }
        setUploads((u) => u.map((x) => (x.key === items[i].key ? { ...x, ...patch } : x)));
      }),
    );
    if (fileRef.current) fileRef.current.value = "";
  }

  const move = (i: number, dir: -1 | 1) =>
    setUploads((u) => {
      const j = i + dir;
      if (j < 0 || j >= u.length) return u;
      const next = [...u];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const len = (s: string) => Array.from(s).length;
  const lead = description || content;
  const results = (state?.data?.results ?? null) as Record<string, { ok: boolean; url: string | null; error: string | null }> | null;
  const ready = uploads.filter((u) => u.id && !u.error);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        act(fd);
      }}
      className="space-y-5"
    >
      <Field label="Title *" htmlFor="c-title" hint={`${len(title)}/300 · the first line everywhere`}>
        <Input id="c-title" name="title" required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="5 signs your website is losing customers" />
      </Field>
      <Field label="Description" htmlFor="c-desc" hint="Short summary. Used as the main text on Bluesky, Threads and Mastodon.">
        <Textarea id="c-desc" name="description" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Content" htmlFor="c-content" hint={`${len(content)} characters. Posted as-is. On short platforms it continues as a thread.`}>
        <Textarea id="c-content" name="content" rows={8} maxLength={10000} value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Link (optional)" htmlFor="c-link" hint="Added at the end with 👉. UTM tags are added if enabled in settings.">
          <Input id="c-link" name="link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://example.com/article" />
        </Field>
        <Field label="Hashtags (optional)" htmlFor="c-tags" hint="Comma-separated, without #.">
          <Input id="c-tags" name="hashtags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="webdesign, smallbusiness, seo" />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">
          Images <span className="text-xs font-normal text-muted">({uploads.length}/{MAX_IMAGES}) · resized and converted to JPEG automatically</span>
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {uploads.map((u, i) => (
            <div key={u.key} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.url ?? u.preview} alt={u.alt || `Image ${i + 1}`} className="aspect-square w-full rounded object-cover" />
                {u.uploading ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40 text-white">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : null}
                <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80" aria-label={`Remove image ${i + 1}`}>
                  <X className="size-3.5" />
                </button>
                {i === 0 ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">Cover</span> : null}
              </div>
              {u.error ? <p className="text-xs text-danger">{u.error}</p> : null}
              <Input value={u.alt} onChange={(e) => setUploads((x) => x.map((y) => (y.key === u.key ? { ...y, alt: e.target.value } : y)))} placeholder="Alt text (SEO)" className="h-8 text-xs" aria-label={`Alt text for image ${i + 1}`} />
              <div className="flex justify-between text-xs">
                <button type="button" className="text-accent disabled:text-subtle" disabled={i === 0} onClick={() => move(i, -1)}>
                  ← Move
                </button>
                <button type="button" className="text-accent disabled:text-subtle" disabled={i === uploads.length - 1} onClick={() => move(i, 1)}>
                  Move →
                </button>
              </div>
            </div>
          ))}
          {uploads.length < MAX_IMAGES ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border text-sm text-muted hover:border-accent hover:text-accent"
            >
              <ImagePlus className="size-6" />
              Add images
              <span className="text-xs">or drop here</span>
            </button>
          ) : null}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        {ready.map((u) => (
          <span key={u.key}>
            <input type="hidden" name="mediaIds" value={u.id} />
            <input type="hidden" name="alts" value={u.alt} />
          </span>
        ))}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Post to</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {platforms.map((p) => {
            const limit = SHORT_LIMITS[p.id];
            const parts = limit && content && description ? 1 + Math.ceil(len(content) / 280) : null;
            return (
              <div key={p.id} className="space-y-0.5">
                <Checkbox
                  name="platforms"
                  value={p.id}
                  checked={selected.includes(p.id)}
                  disabled={!p.connected}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                  label={
                    <span className={p.connected ? "" : "text-subtle"}>
                      {p.name}
                      {!p.connected ? <span className="text-xs"> · not connected</span> : null}
                    </span>
                  }
                />
                {selected.includes(p.id) ? (
                  <p className="pl-6 text-xs text-muted">
                    {p.id === "instagram" && !ready.length ? "Uses the branded image card (no image uploaded)" : p.id === "linkedin" && ready.length ? "Text + link only (images not supported here)" : parts && parts > 1 ? `Thread of ~${Math.min(parts, 11)} posts` : limit && len(lead) > 170 ? "Text shortened, rest as a thread" : (p.note ?? "")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <FormMessage state={state} />
      {results ? (
        <ul className="space-y-1 rounded-md border border-border p-3 text-sm">
          {Object.entries(results).map(([pl, r]) => (
            <li key={pl} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{platforms.find((p) => p.id === pl)?.name ?? pl}</span>
              {r.ok ? (
                r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-success hover:underline">
                    posted <ExternalLink className="size-3" />
                  </a>
                ) : (
                  <span className="text-success">posted</span>
                )
              ) : (
                <span className="text-danger">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="when" value="now" pendingText="Publishing…" disabled={uploading || !selected.length || !title.trim()}>
          Publish now
        </SubmitButton>
        {scheduleLabel ? (
          <Button type="submit" name="when" value="slot" variant="secondary" disabled={uploading || !selected.length || !title.trim()}>
            Schedule for {scheduleLabel}
          </Button>
        ) : null}
        {uploading ? <span className="text-xs text-muted">Waiting for images to upload…</span> : null}
        {state?.data?.postId && !uploading ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              formRef.current?.reset();
              setTitle("");
              setDescription("");
              setContent("");
              setLink("");
              setHashtags("");
              setUploads([]);
            }}
          >
            Start a new post
          </Button>
        ) : null}
      </div>
    </form>
  );
}
