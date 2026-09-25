import type { z } from "zod";
import { AppError } from "./errors";

/** Parses input with a zod schema, raising a safe 400 on failure. */
export function validate<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      "validation_error",
      "The request is invalid.",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export function parseId(value: string | undefined, what = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "invalid_id", `Invalid ${what}.`);
  return id;
}
