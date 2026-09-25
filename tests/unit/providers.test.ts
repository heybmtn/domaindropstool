import { describe, expect, it } from "vitest";
import { DataForSeoClient } from "../../worker/providers/dataforseo/client";
import { NominetDropListProvider } from "../../worker/providers/nominet/provider";

/**
 * Providers must work with their DEFAULT fetcher (the platform fetch).
 * Calling the global fetch with the wrong `this` throws "Illegal invocation"
 * in workerd, which these tests reproduce because they run in the Workers
 * runtime. Port 1 on localhost refuses connections, so no real network is used.
 */
const UNREACHABLE = "http://127.0.0.1:1/uk.csv.gz";

/** Collects the message of the rejection and of every error in its `cause` chain. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" <- ") || String(error);
  }
}

describe("providers use the platform fetch correctly", () => {
  it("Nominet provider calls fetch without an illegal invocation", async () => {
    const provider = new NominetDropListProvider(UNREACHABLE);
    const message = await rejection(provider.getLatest());
    expect(message).not.toMatch(/Illegal invocation/i);
  });

  it("DataForSEO client calls fetch without an illegal invocation", async () => {
    const client = new DataForSeoClient("http://127.0.0.1:1/v3", { login: "u", password: "p" });
    const message = await rejection(client.get("appendix/user_data"));
    expect(message).not.toMatch(/Illegal invocation/i);
  });
});
