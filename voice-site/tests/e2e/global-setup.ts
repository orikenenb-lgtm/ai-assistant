import { createServer, type Server } from "node:http";
import { HOOK_PORT } from "../../playwright.config";

/**
 * A stand-in for the lead webhook (Make / Zapier / CRM). The site under test
 * posts leads here; specs read them back from GET /received.
 */
export default async function globalSetup() {
  const received: unknown[] = [];
  const server: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/hook") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ signature: req.headers["x-signature"] ?? null, body: JSON.parse(body) });
        res.writeHead(200).end("ok");
      });
      return;
    }
    if (req.method === "GET" && req.url === "/received") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(received));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(HOOK_PORT, "127.0.0.1", resolve));
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
