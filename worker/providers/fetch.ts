/**
 * The platform fetch, called unbound. Storing the global `fetch` on an object and
 * calling it as `this.fetcher(...)` throws "Illegal invocation" in Workers, so
 * providers default to this wrapper instead of the bare `fetch` reference.
 */
export const platformFetch: typeof fetch = (input, init) => fetch(input, init);

/** Identifies this tool to upstream services. */
export const USER_AGENT = "domaindropstool/1.0 (+https://github.com/heybmtn/domaindropstool)";
