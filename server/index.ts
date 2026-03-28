import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use((req, res, next) => {
  // Skip JSON parsing for multipart (file uploads)
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    return next();
  }
  express.json({
    verify: (req2, _res, buf) => {
      req2.rawBody = buf;
    },
  })(req, res, next);
});

app.use((req, res, next) => {
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    return next();
  }
  express.urlencoded({ extended: false })(req, res, next);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Password protection
const APP_PASSWORD = process.env.APP_PASSWORD || "Zaibatsu";
const AUTH_COOKIE = "codex_auth";

function passwordGateHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Codex — EPUB Reader</title>
  <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'General Sans', sans-serif; background: #f7f5f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .gate { text-align: center; padding: 2rem; max-width: 340px; width: 100%; }
    .icon { width: 48px; height: 48px; background: rgba(179,92,30,0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; }
    .icon svg { width: 24px; height: 24px; color: #b35c1e; }
    h1 { font-size: 1.25rem; font-weight: 600; color: #2a2520; margin-bottom: 0.25rem; }
    p { font-size: 0.875rem; color: #8a8580; margin-bottom: 1.5rem; }
    input { width: 100%; padding: 0.625rem 0.875rem; border: 1px solid #e0ddd8; border-radius: 8px; font-size: 0.875rem; font-family: inherit; background: white; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #b35c1e; }
    button { width: 100%; margin-top: 0.75rem; padding: 0.625rem; background: #b35c1e; color: white; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 500; font-family: inherit; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #9a4f19; }
    .error { color: #dc2626; font-size: 0.8rem; margin-top: 0.5rem; display: none; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1917; }
      h1 { color: #e0ddd8; }
      p { color: #8a8580; }
      input { background: #2a2520; border-color: #3a3530; color: #e0ddd8; }
      input:focus { border-color: #c9874d; }
      .icon { background: rgba(201,135,77,0.15); }
      .icon svg { color: #c9874d; }
      button { background: #c9874d; }
      button:hover { background: #b35c1e; }
    }
  </style>
</head>
<body>
  <div class="gate">
    <div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
    <h1>Codex</h1>
    <p>Enter the password to access your library</p>
    <form onsubmit="return tryLogin()">
      <input type="password" id="pw" placeholder="Password" autocomplete="current-password" autofocus />
      <button type="submit">Enter</button>
      <div class="error" id="err">Incorrect password</div>
    </form>
  </div>
  <script>
    function tryLogin() {
      fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('pw').value })
      }).then(r => {
        if (r.ok) { window.location.reload(); }
        else { document.getElementById('err').style.display = 'block'; }
      });
      return false;
    }
  </script>
</body>
</html>`;
}

// Auth endpoint
app.post("/api/auth", (req, res) => {
  if (req.body?.password === APP_PASSWORD) {
    res.cookie(AUTH_COOKIE, "granted", { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: "lax" });
    return res.json({ success: true });
  }
  res.status(401).json({ message: "Wrong password" });
});

// Password gate middleware — skip for auth endpoint itself
app.use((req, res, next) => {
  if (req.path === "/api/auth") return next();
  // Parse cookies manually (no cookie-parser needed)
  const cookies = (req.headers.cookie || "").split(";").reduce((acc: Record<string, string>, c) => {
    const [k, v] = c.trim().split("=");
    if (k) acc[k] = v || "";
    return acc;
  }, {});
  if (cookies[AUTH_COOKIE] === "granted") return next();
  // Serve password page for HTML requests, 401 for API
  if (req.path.startsWith("/api/")) return res.status(401).json({ message: "Unauthorized" });
  res.setHeader("Content-Type", "text/html");
  return res.send(passwordGateHTML());
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
