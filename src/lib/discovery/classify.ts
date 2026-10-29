import type { SignalKind } from "@/lib/providers/types";

/**
 * Transparent keyword classifier for public business signals. Each match records the
 * phrases that triggered it so the classification is explainable and auditable.
 */
const RULES: { type: SignalKind; phrases: RegExp[] }[] = [
  {
    type: "website_requirement",
    phrases: [
      /\b(looking for|need|seeking|hiring|want(?:ed)?)\b[^.?!]{0,40}\b(web ?(site)? ?(developer|designer|agency)|website|landing page|webflow|wordpress) ?(developer|designer|expert|freelancer)?/i,
      /\bneed (?:a|an|my) (?:new )?(?:website|site|web presence)\b/i,
      /\bwebsite (?:built|build|development) (?:wanted|needed)\b/i,
      /\brecommend (?:a|an) (?:web|website) (?:developer|designer|agency)\b/i,
    ],
  },
  {
    type: "redesign_requirement",
    phrases: [/\bre-?design(?:ing)? (?:of )?(?:our|my|the) (?:website|site)\b/i, /\b(?:website|site) re-?design\b/i, /\b(?:revamp|refresh|modernize|rebuild) (?:our|my|the) (?:website|site)\b/i],
  },
  {
    type: "ecommerce_requirement",
    phrases: [/\b(?:online store|e-?commerce (?:site|store|website)|shopify (?:store|developer|expert)|woocommerce)\b/i, /\bsell(?:ing)? (?:our|my) products online\b/i],
  },
  {
    type: "hosting_migration",
    phrases: [/\bmigrat(?:e|ing|ion) (?:our|my|the)? ?(?:website|site|hosting|wordpress)\b/i, /\b(?:new|better|cheaper) hosting\b/i, /\bmove (?:our|my) (?:site|website) (?:to|from)\b/i],
  },
  {
    type: "business_launch",
    phrases: [/^show hn\b/i, /\b(?:just )?launch(?:ed|ing)\b/i, /\bgrand opening\b/i, /\bnow open\b/i, /\bopen(?:ed|s|ing) (?:its|our|a) (?:doors|first|new)\b/i, /\bannounc(?:e|es|ed|ing) (?:the )?(?:launch|opening)\b/i, /\bnew (?:startup|business|company|venture)\b/i],
  },
  {
    type: "general_update",
    phrases: [/\b(?:expan(?:d|ds|ding|sion)|new (?:office|location|branch)|raises? \$?\d|funding round|seed round|series [a-d])\b/i],
  },
];

export function classifySignal(text: string): { type: SignalKind; matched: string[] } {
  for (const rule of RULES) {
    const matched = rule.phrases.map((re) => text.match(re)?.[0]).filter((m): m is string => !!m);
    if (matched.length) return { type: rule.type, matched };
  }
  return { type: "general_update", matched: [] };
}

/** True when text explicitly expresses demand for web services (not a mere launch). */
export function isDemandSignal(type: SignalKind) {
  return ["website_requirement", "redesign_requirement", "ecommerce_requirement", "hosting_migration"].includes(type);
}
