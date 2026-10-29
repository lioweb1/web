export const nominatimBerlin = [{ osm_type: "relation", osm_id: 62422, display_name: "Berlin, Deutschland", class: "boundary", type: "administrative" }];

export const overpassBerlin = {
  elements: [
    { type: "node", id: 1001, lat: 52.52, lon: 13.4, timestamp: "2026-10-20T10:00:00Z", tags: { name: "Bäckerei Schmidt", shop: "bakery", "addr:street": "Hauptstr.", "addr:housenumber": "5", "addr:city": "Berlin", "addr:postcode": "10115", phone: "+49 30 1234567" } },
    { type: "way", id: 2002, center: { lat: 52.5, lon: 13.41 }, timestamp: "2026-09-01T10:00:00Z", tags: { name: "Zahnarztpraxis Müller", amenity: "dentist", website: "https://zahnarzt-mueller.de", email: "info@zahnarzt-mueller.de", "addr:city": "Berlin" } },
    { type: "node", id: 3003, lat: 52.51, lon: 13.39, tags: { name: "Café Facebook Only", amenity: "cafe", website: "https://www.facebook.com/cafefb", "addr:city": "Berlin" } },
    { type: "node", id: 4004, lat: 52.51, lon: 13.39, tags: { amenity: "cafe" } },
  ],
};

export const dentistHomepage = `<!doctype html><html><head><title>Zahnarztpraxis Müller Berlin</title>
<meta name="generator" content="WordPress 5.2.1"><script src="/wp-includes/js/jquery/jquery-1.12.4.min.js"></script></head>
<body><h2>Willkommen</h2><img src="a.jpg"><img src="b.jpg"><img src="c.jpg">
<a href="/kontakt">Kontakt</a> <a href="/team">Team</a> <a href="/old-page">Alt</a>
<a href="mailto:info@zahnarzt-mueller.de">E-Mail</a> <a href="tel:+493099999">Anrufen</a>
<a href="https://www.facebook.com/zahnarztmueller">Facebook</a> <a href="https://www.facebook.com/sharer.php?u=x">Share</a>
<center><font>Alt</font></center>
<footer>© 2017 Zahnarztpraxis Müller</footer></body></html>`;

export const dentistContact = `<html><body><p>Schreiben Sie uns: termine@zahnarzt-mueller.de oder gmail@gmail.com</p></body></html>`;
