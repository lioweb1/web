import { PROVIDERS } from "@/lib/providers/registry";

export const metadata = { title: "Data source disclosures" };

const ATTRIBUTION: Record<string, string> = {
  osm: "Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0 — openstreetmap.org/copyright.",
  companies_house: "Contains public sector information licensed under the Open Government Licence v3.0 (Companies House).",
  crtsh: "Certificate data from public Certificate Transparency logs via crt.sh (operated by Sectigo).",
  rdap: "Registration data from registry RDAP services located via the IANA bootstrap registry.",
  hackernews: "Public posts from Hacker News via the HN Search API by Algolia.",
};

export default function DataSources() {
  return (
    <>
      <h1>Data source disclosures</h1>
      <p>LeadOrbit uses only authorized, publicly available sources and the websites businesses publish themselves. It does not log in to, scrape or bypass restrictions on social networks or other platforms. Coverage is limited to what each source contains — there is no claim of complete global coverage.</p>
      {PROVIDERS.map((p) => (
        <section key={p.id}>
          <h2>{p.name}</h2>
          <p>{p.description}</p>
          {p.unavailableReason ? <p><strong>Not used:</strong> {p.unavailableReason}</p> : null}
          <ul>
            <li>
              <strong>License / terms:</strong> {p.licenseNote}
            </li>
            {ATTRIBUTION[p.id] ? (
              <li>
                <strong>Attribution:</strong> {ATTRIBUTION[p.id]}
              </li>
            ) : null}
            <li>
              <strong>Fields used:</strong> {p.dataFields.join(", ")}
            </li>
            <li>
              <strong>Cost:</strong> {p.pricingNote}
            </li>
            <li>
              <strong>Updates:</strong> {p.refreshNote}
            </li>
          </ul>
        </section>
      ))}
      <h2>User-provided sources</h2>
      <p>CSV imports and RSS feeds are added by users, who are responsible for having the right to use them.</p>
    </>
  );
}
