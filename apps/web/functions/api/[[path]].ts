/// <reference types="@cloudflare/workers-types" />

/**
 * Pages Functions API Proxy
 *
 * Proxies all /api/* requests to the Workers API using Service Bindings.
 * This is the idiomatic Cloudflare approach:
 * - Internal network (faster, no egress costs)
 * - Declarative configuration in wrangler.json
 * - Environment-specific bindings (staging vs production)
 *
 * Falls back to fetch for local development when service binding unavailable.
 */

interface Env {
  /** Service binding to the API Worker (configured in wrangler.json) */
  API?: Fetcher;
  /** Fallback URL for local development */
  API_WORKER_URL?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  // Build the path from catch-all params
  const pathSegments = params.path as string[];
  const apiPath = "/api/" + pathSegments.join("/");

  // Construct the full URL for the API request
  const url = new URL(request.url);
  const targetUrl = new URL(apiPath + url.search, url.origin);

  // Clone the request with the API path
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
    redirect: "manual"
  });

  try {
    // Prefer service binding (internal network, no egress costs)
    if (env.API) {
      return env.API.fetch(proxyRequest);
    }

    // Fallback: Direct fetch for local dev or when binding unavailable
    const apiBaseUrl =
      env.API_WORKER_URL || "https://ensayo-quest-api-staging.kokokessy.workers.dev";
    const fallbackUrl = new URL(apiPath + url.search, apiBaseUrl);
    const fallbackRequest = new Request(fallbackUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
      redirect: "manual"
    });

    return fetch(fallbackRequest);
  } catch (error) {
    console.error("API proxy error:", error);
    return new Response(JSON.stringify({ error: "proxy_error", message: String(error) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
};
