/** Web-standard Response helpers shared by every route in the core. */

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export function notFound(message = "Not found"): Response {
  return errorResponse(message, 404);
}

export function notImplemented(message = "Not supported"): Response {
  return errorResponse(message, 501);
}
