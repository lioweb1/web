import { LINK_TOKEN } from "./ai";

/** Everything blog platforms need for one long-form post. */
export type Article = { title: string; markdown: string; html: string; excerpt: string; tags: string[]; canonicalUrl: string | null; coverUrl: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(md: string) {
  return esc(md)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/** Small, safe Markdown → HTML (headings, paragraphs, lists, quotes, images, links, emphasis). */
export function markdownToHtml(md: string) {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br />")}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) flush();
    else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flush();
      const level = Math.min(4, m[1].length + 1); // the post title is the page's h1
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      if (para.length || list?.tag === "ol") flush();
      list ??= { tag: "ul", items: [] };
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (para.length || list?.tag === "ul") flush();
      list ??= { tag: "ol", items: [] };
      list.items.push(m[1]);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/** Lowercase alphanumeric tags (DEV allows 4, others more). */
export function cleanTags(tags: string[], max = 10) {
  return [...new Set(tags.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter((t) => t.length >= 2))].slice(0, max);
}

/**
 * Build the blog article for a post: an AI-written article when present, otherwise the post's
 * own text. Images go into the body, the link becomes a call to action and the canonical URL.
 */
export function buildArticle(input: { title: string; article?: string | null; body: string; metaDescription?: string | null; hashtags: string[]; link: string; images: { url: string; alt: string | null }[] }): Article {
  const link = input.link;
  const text = (input.article?.trim() || input.body.trim()).replace(/^#\s+.*\n+/, "");
  const withLink = link ? text.split(LINK_TOKEN).join(link) : text.replace(new RegExp(`\\s*\\S*\\s*${LINK_TOKEN.replace(/[{}]/g, "\\$&")}`, "g"), "");
  const [cover, ...rest] = input.images;
  const gallery = rest.map((i) => `![${(i.alt ?? input.title).replace(/[\[\]]/g, "")}](${i.url})`).join("\n\n");
  const cta = link && !withLink.includes(link) ? `\n\n**[Read the full guide →](${link})**` : "";
  const markdown = [withLink.trim(), gallery, cta.trim()].filter(Boolean).join("\n\n");
  const plain = text.replace(/[#*_`>\[\]()!]/g, "").replace(/https?:\/\/\S+/g, "").replace(/\{LINK\}/g, "").replace(/\s+/g, " ").trim();
  const excerpt = (input.metaDescription?.trim() || plain).slice(0, 160).trim();
  return {
    title: input.title.trim(),
    markdown,
    html: (cover ? `<p><img src="${esc(cover.url)}" alt="${esc(cover.alt ?? input.title)}" /></p>\n` : "") + markdownToHtml(markdown),
    excerpt,
    tags: cleanTags(input.hashtags),
    canonicalUrl: link || null,
    coverUrl: cover?.url ?? null,
  };
}
