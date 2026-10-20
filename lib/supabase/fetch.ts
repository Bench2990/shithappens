/** Ne tartson végtelen ideig egy függő kérés. Az ismétlést az idempotens RPC-k teszik biztonságossá. */
export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const original = init?.signal;
  const abort = () => controller.abort();
  if (original?.aborted) controller.abort();
  else original?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 25_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    original?.removeEventListener("abort", abort);
  }
}
