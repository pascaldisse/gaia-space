// Throwaway local dev glue for the Paleblood palette screenshot proof.
// Serves the real `vite build --mode web` bundle (dist-web/, base /space/)
// and proxies /space/api, /space/caldav, /space/oauth to the real
// space-server backend on SPACE_PORT (127.0.0.1) — same origin, no CORS.
// Not part of the app; lives only under proof/ for this one verification run.
const DIST = new URL("../../dist-web/", import.meta.url);
const BACKEND = `http://127.0.0.1:${process.env.SPACE_PORT || 8090}`;
const PORT = Number(process.env.PROXY_PORT || 4173);

const mime = (path) => {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    if (path.startsWith("/space/api/") || path.startsWith("/space/caldav/") || path.startsWith("/space/oauth/")) {
      const upstream = BACKEND + path.slice("/space".length) + url.search;
      const init = { method: req.method, headers: req.headers };
      if (!["GET", "HEAD"].includes(req.method)) init.body = await req.arrayBuffer();
      const res = await fetch(upstream, init);
      return new Response(res.body, { status: res.status, headers: res.headers });
    }

    if (path === "/") path = "/space/";
    if (!path.startsWith("/space/")) return new Response("not found", { status: 404 });
    let rel = path.slice("/space/".length) || "index.html";
    let file = Bun.file(new URL(rel, DIST));
    if (!(await file.exists())) { rel = "index.html"; file = Bun.file(new URL(rel, DIST)); } // SPA fallback
    return new Response(file, { headers: { "content-type": mime(rel) } });
  },
});
console.log(`proxy on http://127.0.0.1:${PORT} -> dist-web + ${BACKEND}`);
