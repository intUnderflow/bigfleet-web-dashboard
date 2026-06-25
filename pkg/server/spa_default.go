//go:build !embed_ui

package server

import "net/http"

const placeholderHTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>bigfleet-web-dashboard — UI not built</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 680px; margin: 4rem auto; padding: 0 1rem; color: #222; line-height: 1.5; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 0.95em; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>bigfleet-web-dashboard</h1>
    <p>This binary was built without the UI bundle.</p>
    <p>For development: <code>make ui-dev</code> (vite hot-reload on :5173, proxies /api → :8080).</p>
    <p>For a single embedded binary: <code>make build</code>.</p>
    <p>The JSON API is available at <a href="/api/health"><code>/api/health</code></a> and <a href="/api/config"><code>/api/config</code></a>.</p>
  </body>
</html>
`

func (s *Server) spaHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(placeholderHTML))
	})
}
