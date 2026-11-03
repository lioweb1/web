import { LegalPage } from "@/components/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Privacy Policy — MedChrono AI" };

export default function PrivacyPage() {
  const C = LEGAL.company;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what information {C} collects when you use {LEGAL.product}, how we use it and the choices you have. Medical records you upload
        are also covered by the Business Associate Addendum in our <a href="/terms" className="text-teal underline">Terms of Service</a>.
      </p>

      <h2>Medical records you upload</h2>
      <ul>
        <li>Records are sent over an encrypted connection, processed in memory to produce your chronology, and then discarded. We do not save them to disk or to our database.</li>
        <li>To read the records, the text and images of the pages are sent to our AI model provider under a business associate agreement and contractual terms that prohibit using them for training.</li>
        <li>Reports, CSV files, letters and saved case files are created in your browser and downloaded to your device. We do not receive a copy.</li>
        <li>Your firm letterhead settings are stored only in your browser.</li>
      </ul>

      <h2>Information we do keep</h2>
      <ul>
        <li><b>Account information:</b> your name, work email, firm name, role, a hashed password, and when you accepted these policies.</li>
        <li><b>Billing information:</b> plan, credit balance and Stripe customer and subscription IDs. Card details are collected and stored by Stripe, never by us.</li>
        <li><b>Usage records:</b> for each case, the date, the team member, and the number of pages and files. We do not keep case names, patient names or file names.</li>
        <li><b>Security and technical data:</b> session records, sign-in attempts (email and IP address, kept for up to one day) and server logs used to keep the Service secure and working.</li>
        <li><b>Messages:</b> emails you send us and transactional emails we send you (password resets, invitations).</li>
      </ul>

      <h2>How we use it</h2>
      <p>To provide and secure the Service, process payments, prevent abuse, support you, and send service messages. We do not sell or rent personal information, and we do not use it for third-party advertising.</p>

      <h2>Service providers</h2>
      <ul>
        <li>Cloud hosting and email delivery (for example Amazon Web Services)</li>
        <li>AI model provider (Anthropic) for reading records during processing</li>
        <li>Payment processing (Stripe)</li>
      </ul>
      <p>Each provider may use the information only to provide its service to us, under written agreements.</p>

      <h2>Cookies</h2>
      <p>We use one essential cookie to keep you signed in. We do not use advertising or cross-site tracking cookies.</p>

      <h2>Retention</h2>
      <p>Account and billing records are kept while your account is open and for as long as needed afterward for tax, accounting and legal obligations (typically 7 years for billing records). Sign-in attempt records are deleted within a day; expired sessions are deleted regularly.</p>

      <h2>Security</h2>
      <p>We use encryption in transit (TLS) and at rest, hashed passwords and session tokens, access controls, and least-privilege access for our staff. No method is perfectly secure, and we will notify affected customers of a breach as required by law and our agreements.</p>

      <h2>Your rights</h2>
      <p>Depending on where you live (for example California under the CCPA/CPRA), you may have the right to know, access, correct or delete your personal information and to not be discriminated against for using these rights. Account owners can also ask us to close the firm&apos;s account. Email {LEGAL.privacyEmail} and we will respond within the time required by law. We may need to verify your identity first.</p>

      <h2>Children</h2>
      <p>The Service is for professional use and is not directed to anyone under 18.</p>

      <h2>Changes and contact</h2>
      <p>We will post changes here and notify account owners of material changes. Questions: {LEGAL.privacyEmail}, {LEGAL.address}.</p>
    </LegalPage>
  );
}
