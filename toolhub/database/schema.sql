-- ToolHub database schema (MySQL 5.7+ / MariaDB 10.3+)
-- Import this file in cPanel > phpMyAdmin > (your database) > Import.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(190) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('user','admin') NOT NULL DEFAULT 'user',
  status          ENUM('active','banned') NOT NULL DEFAULT 'active',
  credits         INT NOT NULL DEFAULT 0,
  plan_name       VARCHAR(100) NULL,
  plan_expires_at DATETIME NULL,
  last_login_at   DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_credits CHECK (credits >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reset_token (token_hash),
  KEY idx_reset_user (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip          VARCHAR(45) NOT NULL,
  email       VARCHAR(190) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attempts_ip (ip, created_at),
  KEY idx_attempts_email (email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plans / credit packs a customer can buy.
-- days > 0  => subscription: extends the plan by this many days and adds credits.
-- days = 0  => top-up pack: only adds credits (needs an active plan to use).
CREATE TABLE IF NOT EXISTS packages (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  credits     INT UNSIGNED NOT NULL,
  days        INT UNSIGNED NOT NULL DEFAULT 30,
  price_usd   DECIMAL(12,2) NOT NULL,  -- all prices are in US dollars
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  sort        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tools. type = 'ai_text' (Claude API) or 'seo_keywords' (DataForSEO API).
CREATE TABLE IF NOT EXISTS tools (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug              VARCHAR(80) NOT NULL,
  name              VARCHAR(100) NOT NULL,
  category          VARCHAR(50) NOT NULL,
  icon              VARCHAR(16) NOT NULL DEFAULT '✨',
  description       VARCHAR(255) NOT NULL DEFAULT '',
  type              ENUM('ai_text','seo_keywords') NOT NULL DEFAULT 'ai_text',
  system_prompt     TEXT NULL,
  input_label       VARCHAR(120) NOT NULL DEFAULT 'Your input',
  input_placeholder VARCHAR(255) NOT NULL DEFAULT '',
  show_tone         TINYINT(1) NOT NULL DEFAULT 0,
  show_language     TINYINT(1) NOT NULL DEFAULT 1,
  credit_cost       INT UNSIGNED NOT NULL DEFAULT 1,
  is_new            TINYINT(1) NOT NULL DEFAULT 0,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  sort              INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tools_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pinned_tools (
  user_id   INT UNSIGNED NOT NULL,
  tool_id   INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, tool_id),
  CONSTRAINT fk_pin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pin_tool FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment methods shown on the checkout page.
-- kind = 'gateway' => automatic (API keys in config.php)
-- kind = 'manual'  => customer sends money and submits the transaction ID; admin approves.
CREATE TABLE IF NOT EXISTS payment_methods (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(40) NOT NULL,
  name            VARCHAR(80) NOT NULL,
  kind            ENUM('gateway','manual') NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  account_details TEXT NULL,
  instructions    TEXT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 0,
  sort            INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_methods_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  package_id     INT UNSIGNED NOT NULL,
  package_name   VARCHAR(100) NOT NULL,
  credits        INT UNSIGNED NOT NULL,
  days           INT UNSIGNED NOT NULL,
  method_code    VARCHAR(40) NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'USD',
  amount         DECIMAL(12,2) NOT NULL,
  status         ENUM('pending','awaiting_review','paid','rejected','cancelled','failed') NOT NULL DEFAULT 'pending',
  gateway_ref    VARCHAR(191) NULL,
  gateway_txn    VARCHAR(191) NULL,
  manual_sender  VARCHAR(191) NULL,
  manual_txid    VARCHAR(191) NULL,
  admin_note     VARCHAR(255) NULL,
  paid_at        DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_user (user_id, created_at),
  KEY idx_orders_status (status),
  UNIQUE KEY uq_orders_gateway_ref (method_code, gateway_ref),
  UNIQUE KEY uq_orders_manual_txid (method_code, manual_txid),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every credit change. (ref_type, ref_id) is unique so an order can never be credited twice.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  delta          INT NOT NULL,
  balance_after  INT NOT NULL,
  reason         VARCHAR(191) NOT NULL,
  ref_type       VARCHAR(30) NULL,
  ref_id         INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_user (user_id, created_at),
  UNIQUE KEY uq_ledger_ref (ref_type, ref_id),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tool_usage (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  tool_id     INT UNSIGNED NOT NULL,
  credits     INT UNSIGNED NOT NULL,
  status      ENUM('running','success','failed') NOT NULL DEFAULT 'running',
  input_text  MEDIUMTEXT NULL,
  output_text MEDIUMTEXT NULL,
  error       VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_usage_user (user_id, created_at),
  CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_usage_tool FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhook de-duplication (a provider may deliver the same event more than once).
CREATE TABLE IF NOT EXISTS webhook_events (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider    VARCHAR(40) NOT NULL,
  event_id    VARCHAR(191) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_event (provider, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed data (edit any of this later from the Admin panel)
-- ---------------------------------------------------------------------------

INSERT INTO packages (name, description, credits, days, price_usd, is_featured, sort) VALUES
('Starter',    '30 days access, 100 credits',  100, 30,  5.00, 0, 1),
('Pro',        '30 days access, 500 credits',  500, 30, 15.00, 1, 2),
('Business',   '30 days access, 2000 credits', 2000, 30, 49.00, 0, 3),
('Top-up 100', 'Extra 100 credits (needs an active plan)', 100, 0, 4.00, 0, 4);

INSERT INTO payment_methods (code, name, kind, currency, account_details, instructions, is_active, sort) VALUES
('stripe',         'Credit / Debit Card',          'gateway', 'USD', NULL, 'Visa, Mastercard, American Express, Apple Pay, Google Pay (secured by Stripe).', 0, 1),
('paypal',         'PayPal',                       'gateway', 'USD', NULL, 'Pay with your PayPal balance or any card through PayPal.', 0, 2),
('nowpayments',    'Crypto (USDT, BTC, ETH, 100+)', 'gateway', 'USD', NULL, 'Pay with USDT (TRC20/ERC20/BEP20), BTC, ETH, LTC, BNB, TRX and more.', 0, 3),
('binancepay',     'Binance Pay',                  'gateway', 'USD', NULL, 'Pay instantly from your Binance app.', 0, 4),
('usdt_trc20',     'USDT (TRC20)',                 'manual',  'USD', 'USDT TRC20 address: TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'Send the exact amount in USDT on the TRON (TRC20) network only. Then enter your wallet address and the transaction hash (TxID) below.', 0, 10),
('usdt_bep20',     'USDT (BEP20 / BSC)',           'manual',  'USD', 'USDT BEP20 address: 0xXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 'Send the exact amount in USDT on the BNB Smart Chain (BEP20) network only. Then enter your wallet address and the transaction hash (TxID) below.', 0, 11),
('binance_manual', 'Binance Pay ID',               'manual',  'USD', 'Binance Pay ID: 000000000', 'In the Binance app go to Pay > Send, enter the Pay ID above and send the exact amount in USDT. Then enter your Binance nickname/ID and the Order ID below.', 0, 12),
('bybit_manual',   'Bybit (UID transfer)',         'manual',  'USD', 'Bybit UID: 000000000', 'In the Bybit app send the exact amount in USDT to the UID above (internal transfer, no fee). Then enter your UID and the transfer ID below.', 0, 13),
('wise_manual',    'Wise',                         'manual',  'USD', 'Wise email: you@example.com', 'Send the exact amount in USD via Wise to the email above. Then enter your full name and the Wise transfer number below.', 0, 14);

INSERT INTO tools (slug, name, category, icon, description, type, system_prompt, input_label, input_placeholder, show_tone, show_language, credit_cost, is_new, sort) VALUES
('blog-writer', 'AI Blog Writer', 'Content Writing', '📝', 'Write a complete, SEO-friendly blog post from a topic.', 'ai_text',
 'You are an expert blog writer. Write a complete, well-structured, SEO-friendly blog post about the topic the user gives. Use a compelling title, an introduction, H2/H3 subheadings, short paragraphs, bullet points where useful, and a conclusion. Do not invent statistics or quotes.',
 'Blog topic or title', 'e.g. 10 ways to grow a small business with Facebook', 1, 1, 5, 0, 1),
('paraphraser', 'Paraphraser', 'Content Writing', '🔁', 'Rewrite text in fresh words while keeping the meaning.', 'ai_text',
 'You rewrite text. Paraphrase the user''s text so it reads naturally in new wording while keeping the original meaning, facts and length roughly the same. Return only the rewritten text.',
 'Text to paraphrase', 'Paste your text here…', 1, 1, 1, 0, 2),
('grammar-checker', 'Grammar Checker', 'Content Writing', '✅', 'Fix grammar, spelling and punctuation.', 'ai_text',
 'You are a careful proofreader. Correct the grammar, spelling and punctuation of the user''s text without changing its meaning or style. First return the corrected text, then a short bullet list titled "Changes" explaining the main fixes.',
 'Text to check', 'Paste your text here…', 0, 0, 1, 0, 3),
('summarizer', 'Text Summarizer', 'Content Writing', '📄', 'Turn long text into a short, clear summary.', 'ai_text',
 'Summarize the user''s text. Give a one-sentence TL;DR, then 3-7 bullet points with the key points. Do not add information that is not in the text.',
 'Text to summarize', 'Paste an article, report or notes…', 0, 1, 1, 0, 4),
('translator', 'AI Translator', 'Content Writing', '🌐', 'Translate between English and 50+ languages.', 'ai_text',
 'You are a professional translator. Translate the user''s text into the requested output language naturally and accurately, keeping formatting. Return only the translation.',
 'Text to translate', 'Paste the text you want to translate…', 0, 1, 1, 0, 5),
('article-rewriter', 'Article Rewriter', 'Content Writing', '✍️', 'Rewrite a full article into a fresh, unique version.', 'ai_text',
 'You are an expert editor. Rewrite the user''s article into a fresh, unique, well-structured version with new wording and a clear flow, keeping all facts and the overall meaning. Do not add facts that are not in the original.',
 'Article to rewrite', 'Paste the full article here…', 1, 1, 3, 1, 6),
('seo-meta', 'SEO Meta Generator', 'SEO', '🔎', 'Generate SEO titles and meta descriptions.', 'ai_text',
 'You are an SEO specialist. For the page or topic the user describes, write 5 SEO title options (max 60 characters each) and 5 meta description options (max 155 characters each). Include the main keyword naturally. Show character counts.',
 'Page topic / main keyword', 'e.g. Best budget smartphones 2026', 0, 1, 1, 0, 10),
('keyword-ideas', 'Keyword Ideas (AI)', 'SEO', '💡', 'Brainstorm keyword ideas grouped by search intent.', 'ai_text',
 'You are an SEO keyword strategist. For the seed keyword the user gives, brainstorm 40 related keyword ideas grouped by search intent (informational, commercial, transactional, navigational), plus 10 long-tail questions. Note that these are ideas, not measured search volumes.',
 'Seed keyword', 'e.g. digital marketing course', 0, 1, 2, 0, 11),
('keyword-research', 'Keyword Research (Live Data)', 'SEO', '📊', 'Real Google search volume, CPC and competition.', 'seo_keywords', NULL,
 'Seed keyword', 'e.g. web design', 0, 0, 3, 1, 12),
('blog-outline', 'Blog Outline Generator', 'SEO', '🧭', 'Create an SEO content outline with headings and FAQs.', 'ai_text',
 'You are an SEO content strategist. Create a detailed blog outline for the user''s topic: suggested title, target keyword, search intent, H2/H3 structure with notes for each section, and 5 FAQs.',
 'Topic', 'e.g. How to start freelancing', 0, 1, 2, 0, 13),
('faq-generator', 'FAQ Generator', 'SEO', '❓', 'Generate FAQs with answers for any page.', 'ai_text',
 'Write 10 frequently asked questions with clear, accurate, concise answers about the user''s topic, suitable for an FAQ section of a website.',
 'Topic / product', 'e.g. Web hosting for beginners', 0, 1, 1, 0, 14),
('fb-caption', 'Social Media Caption', 'Social Media', '📱', 'Captions for Facebook, Instagram and LinkedIn.', 'ai_text',
 'You are a social media copywriter. Write 5 engaging caption options for the post the user describes. Each should have a hook, short body, a call to action and 3-5 relevant hashtags.',
 'What is the post about?', 'e.g. New summer collection launch for my clothing shop', 1, 1, 1, 0, 20),
('hashtag-generator', 'Hashtag Generator', 'Social Media', '#️⃣', 'Relevant hashtags for more reach.', 'ai_text',
 'Generate 30 relevant hashtags for the topic the user gives, grouped into popular, medium and niche. Return them ready to copy.',
 'Topic', 'e.g. home bakery business', 0, 0, 1, 0, 21),
('youtube-script', 'YouTube Script Writer', 'Social Media', '🎬', 'Full video script with hook, sections and CTA.', 'ai_text',
 'You are a YouTube scriptwriter. Write a complete video script for the user''s topic: a strong 10-second hook, intro, main sections with on-screen notes, and an outro with a call to action.',
 'Video topic', 'e.g. How to earn money from Fiverr as a beginner', 1, 1, 4, 0, 22),
('youtube-seo', 'YouTube Title & Tags', 'Social Media', '▶️', 'Click-worthy titles, description and tags.', 'ai_text',
 'For the video the user describes, write 5 click-worthy (not misleading) titles under 70 characters, an SEO-friendly description of about 150 words, and 20 tags separated by commas.',
 'Video topic', 'e.g. Unboxing the new budget phone', 0, 1, 1, 0, 23),
('ad-copy', 'Ad Copy Writer', 'Marketing', '📣', 'Facebook and Google ad copy that converts.', 'ai_text',
 'You are a direct-response copywriter. For the product or offer the user describes, write 3 Facebook ad variations (primary text, headline, description) and 3 Google search ad variations (3 headlines up to 30 characters, 2 descriptions up to 90 characters). Make no false or exaggerated claims.',
 'Product / offer', 'e.g. Online English course, 30% off this week', 1, 1, 2, 0, 30),
('product-description', 'Product Description', 'Marketing', '🛍️', 'Persuasive e-commerce product descriptions.', 'ai_text',
 'Write a persuasive e-commerce product description for the product the user describes: a short intro, 5 benefit-focused bullet points, and a closing line. Do not invent specifications that the user did not provide.',
 'Product details', 'e.g. Cotton t-shirt, 180 GSM, sizes M-XXL, 5 colors', 1, 1, 1, 0, 31),
('email-writer', 'Email Writer', 'Marketing', '✉️', 'Professional emails in seconds.', 'ai_text',
 'Write a clear, professional email for the situation the user describes. Include a subject line. Keep it concise.',
 'What is the email for?', 'e.g. Follow up with a client about an unpaid invoice', 1, 1, 1, 0, 32),
('landing-copy', 'Landing Page Copy', 'Marketing', '🚀', 'Headline, benefits, FAQ and CTA for a landing page.', 'ai_text',
 'Write landing page copy for the product or service the user describes: hero headline and sub-headline, 3 benefit sections, a features list, 3 testimonials placeholders clearly marked as placeholders, an FAQ, and a call to action.',
 'Product / service', 'e.g. Bookkeeping service for small shops', 1, 1, 3, 1, 33),
('business-names', 'Business Name Generator', 'Business', '🏷️', 'Creative brand and business name ideas.', 'ai_text',
 'Suggest 25 creative, short, memorable business names for the business the user describes, each with a one-line explanation. Add 5 slogan ideas at the end.',
 'Describe your business', 'e.g. Organic food delivery service', 0, 0, 1, 0, 40),
('cover-letter', 'Cover Letter Writer', 'Business', '💼', 'Tailored cover letters for job applications.', 'ai_text',
 'Write a tailored, professional cover letter based on the job and candidate details the user provides. Do not invent experience the user did not mention; use placeholders like [Your Name] where details are missing.',
 'Job + your experience', 'Paste the job post and a few lines about your experience…', 1, 1, 2, 0, 41),
('business-plan', 'Business Plan Outline', 'Business', '📈', 'A structured business plan draft.', 'ai_text',
 'Create a structured business plan draft for the idea the user describes: executive summary, problem, solution, target market, competitors, marketing plan, operations, a simple cost and revenue outline with clearly stated assumptions, and next steps.',
 'Your business idea', 'e.g. A cloud kitchen selling healthy lunch boxes', 0, 1, 4, 0, 42),
('code-explainer', 'Code Explainer', 'Developer', '🧑‍💻', 'Explain any code line by line in simple words.', 'ai_text',
 'You are a patient senior developer. Explain what the user''s code does in simple words: a short summary, then a step-by-step explanation, then any bugs or improvements you notice.',
 'Paste your code', 'Paste code here…', 0, 1, 2, 0, 50),
('code-generator', 'Code Generator', 'Developer', '⚙️', 'Generate code snippets from a description.', 'ai_text',
 'You are an expert software engineer. Write clean, working, commented code for what the user asks. State the language and any assumptions, then give the code in a code block, then brief usage notes.',
 'What should the code do?', 'e.g. PHP function to validate an international phone number', 0, 0, 2, 0, 51),
('regex-generator', 'Regex Generator', 'Developer', '🔣', 'Build and explain regular expressions.', 'ai_text',
 'Write a regular expression for what the user describes. Give the pattern, an explanation of each part, and 3 matching and 3 non-matching examples.',
 'What should it match?', 'e.g. Email addresses ending in .com.bd', 0, 0, 1, 0, 52);
