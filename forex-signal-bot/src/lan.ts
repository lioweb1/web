import { networkInterfaces } from "node:os";

/** `--lan` on the command line makes the dashboard reachable from phones on the same Wi-Fi. */
export function dashboardHost(argv = process.argv): string {
  return argv.includes("--lan") || process.env.HOST === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
}

/** http://<ip>:<port> for every IPv4 address of this computer, when listening on the LAN. */
export function lanUrls(host: string, port: number): string[] {
  if (host !== "0.0.0.0") return [];
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${port}`);
    }
  }
  return urls;
}
