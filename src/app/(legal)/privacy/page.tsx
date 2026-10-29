export const metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p>Last updated: [date]. Controller: [your company name, address, contact email].</p>
      <h2>1. Who this covers</h2>
      <p>This policy covers (a) users of LeadOrbit AI (“users”) and (b) businesses and business representatives whose publicly available business information appears in the service (“business contacts”).</p>
      <h2>2. Data we process about users</h2>
      <ul>
        <li>Account data: name, email address, password hash (never the password itself), workspace memberships and roles.</li>
        <li>Usage data: sessions (IP address and browser user-agent), audit logs of important actions, usage counters.</li>
        <li>Content you create: leads, notes, tags, tasks, monitoring rules and settings. API keys you add are encrypted at rest.</li>
      </ul>
      <p>Legal basis: performance of our contract with you, and our legitimate interest in securing the service.</p>
      <h2>3. Data we process about business contacts</h2>
      <p>We collect only business information that is published for business purposes by the business itself or by an authorized source: business name, category, business address, official website, published business email and phone numbers, links to public company pages, company-register entries, domain registration dates (registrant personal data is redacted by registries and never collected), and public posts announcing launches or requesting services. We do not collect data from private social-media accounts, do not bypass logins or technical restrictions, and never guess or generate email addresses or phone numbers.</p>
      <p>Legal basis: legitimate interest in business-to-business prospecting (balanced against the interests of the people concerned). Where a business email identifies a person, users must comply with applicable marketing laws (e.g. GDPR, ePrivacy/PECR, CAN-SPAM, CASL) before contacting them.</p>
      <h2>4. Retention</h2>
      <p>User account data is kept while the account exists and deleted or anonymized on account deletion. Workspace data is kept until the workspace is deleted. Shared public business records are refreshed from their sources and removed when no longer needed or on request. Audit logs are kept for [12] months.</p>
      <h2>5. Your rights and opt-out</h2>
      <p>You may request access, correction, deletion, restriction or objection, and data portability. Users can export workspace data and delete workspaces or accounts in Settings → Privacy &amp; data. Business contacts can ask to be removed by emailing [privacy@example.com]; we will delete stored contact details and suppress the business from future collection within [30] days. You may also complain to your data-protection authority.</p>
      <h2>6. Sharing and sub-processors</h2>
      <p>By default a self-hosted installation uses no sub-processors beyond your hosting and email (SMTP) providers: [list them]. Data is sent to third parties only when you configure it, e.g. webhooks or a HubSpot integration. We do not sell personal data.</p>
      <h2>7. Security</h2>
      <p>Passwords are hashed with scrypt; sessions use HTTP-only cookies; workspace data is isolated with database row-level security; API keys are encrypted with AES-256-GCM; access is role-based and important actions are logged.</p>
      <h2>8. International transfers</h2>
      <p>[Describe where data is hosted and the transfer safeguards used, if any.]</p>
      <h2>9. Contact</h2>
      <p>[privacy@example.com]</p>
    </>
  );
}
