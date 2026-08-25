/**
 * Australia Post Postage Assessment Calculator (PAC), called straight with
 * `fetch`.
 *
 * Same shape as `lib/email.ts`, for the same reasons: no npm client for what is
 * a handful of GETs, **nothing here ever throws**, and every path returns a
 * result the caller can branch on. A postage lookup is a step inside rendering
 * a cart and inside creating a checkout session; neither may fail because a
 * carrier's API is slow.
 *
 * ## Traps this file exists to absorb
 *
 * These are all verified against the live API, not inferred from the docs.
 *
 * - **A one-element list is an object.** `services.service`, `costs.cost` and
 *   `options.option` come back as a bare object when there is one entry and as
 *   an array when there are several — sometimes both in the same document. A
 *   real response observed here had `options.option` as a 2-element array whose
 *   members each carried `suboptions.option` as a single object. Anything that
 *   indexes `[0]` without normalising is a crash waiting for a quiet basket.
 * - **Money is a string.** `"10.20"`, never `10.2`. Parsed digit-by-digit into
 *   integer cents below — never through a float multiply.
 * - **An error is not signalled by the status.** The documented behaviour is a
 *   200 carrying `{"error":{"errorMessage":"..."}}`. What this environment
 *   actually returns for the same bad requests is a **404** carrying the same
 *   body. Both happen, so neither is trusted: the body is parsed first and
 *   `error.errorMessage` is the authority, whatever the status line says.
 * - **The letter endpoint's parameter is `thickness`, not `height`**, and it
 *   takes no postcodes — domestic letters are flat-rate nationally.
 *
 * ## Units, which differ per endpoint
 *
 * Parcels: centimetres and kilograms. Letters: millimetres and grams. The
 * exported functions take millimetres and grams throughout and convert at the
 * boundary, so no caller has to remember which is which.
 */

import { PACKAGING } from "./dimensions";

const PAC_BASE = "https://digitalapi.auspost.com.au/postage";

/**
 * Short, because a customer is waiting on the render behind it. PAC answers in
 * 0.8–1.9 s when healthy, so 2.5 s catches a genuinely sick call without
 * abandoning a merely slow one. Anything slower falls through to the cached or
 * fallback price, which is the whole point of having them.
 */
const REQUEST_TIMEOUT_MS = 2_500;

/** Provider error bodies are unbounded; one line of one is enough to log. */
const MAX_DETAIL_LENGTH = 300;

export type PacFailureReason =
  /** AUSPOST_API_KEY missing — nothing was attempted. */
  | "not_configured"
  /** No answer inside REQUEST_TIMEOUT_MS. */
  | "timeout"
  /** DNS/TLS/socket failure — the request never got an HTTP response. */
  | "network_error"
  /** The API said no, in its own words. `detail` is its `errorMessage`. */
  | "api_error"
  /** A non-2xx with nothing we recognise in the body. */
  | "http_error"
  /** 2xx, but the shape was not what this parser knows how to read. */
  | "bad_response";

export type PacResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: PacFailureReason;
      /** HTTP status when there was one, otherwise null. */
      status: number | null;
      /** Safe to log: length-capped, and PAC error text carries no PII. */
      detail: string;
    };

/** One purchasable service, price already in integer cents. */
export type PacService = {
  code: string;
  name: string;
  priceCents: number;
};

/** The answer to "what does this exact service cost for this exact package?" */
export type PacCalculation = {
  serviceName: string;
  deliveryTime: string | null;
  totalCents: number;
  /** Itemised lines. One entry for a plain quote, several with options added. */
  costs: { item: string; cents: number }[];
};

export type ParcelRequest = {
  fromPostcode: string;
  toPostcode: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
};

export type LetterRequest = {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  weightGrams: number;
};

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

/**
 * Whether this process holds a PAC key.
 *
 * **Server-only, and it throws in the browser rather than lying.**
 * `AUSPOST_API_KEY` is not `NEXT_PUBLIC_`, so Next replaces the read with
 * `undefined` in a client bundle and this would silently answer `false` there
 * while the server said `true` — the exact skew `lib/email.ts` documents at
 * length. Postage must be quoted on the server anyway; a client component that
 * needs to know gets the answer as a prop.
 *
 * The API does in fact answer unauthenticated today, which is convenient for
 * development and not something to build on: it is undocumented, unpromised,
 * and the key is free and self-serve. So an absent key is treated as "not
 * configured" and the quote falls through to the fallback table rather than
 * quietly depending on a courtesy that can be withdrawn without notice.
 */
export function isPacConfigured(): boolean {
  if (typeof window !== "undefined") {
    throw new Error(
      "isPacConfigured() was called in the browser, where AUSPOST_API_KEY is " +
        "undefined and it could only ever answer false. Quote postage on the " +
        "server and pass the result down.",
    );
  }
  return Boolean(process.env.AUSPOST_API_KEY);
}

/** Logged at most once per process, so an unconfigured deploy is visible
 *  without every basket render adding a line. */
let warnedUnconfigured = false;

function notConfigured<T>(): PacResult<T> {
  if (!warnedUnconfigured) {
    warnedUnconfigured = true;
    console.info(
      "[shipping] AUSPOST_API_KEY is unset — postage is being quoted from the " +
        "fallback rate table, which is deliberately pessimistic. Set the key " +
        "(free, self-serve) to quote live rates.",
    );
  }
  return {
    ok: false,
    reason: "not_configured",
    status: null,
    detail: "AUSPOST_API_KEY is unset.",
  };
}

/* -------------------------------------------------------------------------
 * Shape and money normalisation
 * ---------------------------------------------------------------------- */

/**
 * The object-or-array fix, applied everywhere PAC has a plural node.
 *
 * `[].concat(x)` is the usual idiom for this; `Array.isArray` is the same
 * operation with a type TypeScript can follow, and unlike `concat` it does not
 * flatten a nested array by accident.
 */
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * `"10.20"` → `1020`. Integer arithmetic only.
 *
 * The float route — `Math.round(parseFloat(s) * 100)` — is the defect this
 * guards. `parseFloat("10.20") * 100` is `1020.0000000000001` on this runtime,
 * and while `Math.round` happens to rescue that one, the same expression is
 * what produces the classic `1019.9999999999999` for other values, and a
 * caller that reaches for `Math.floor` or `| 0` instead of `Math.round` turns
 * it into a one-cent shortfall on every order. So the string is split on the
 * decimal point and the two halves are combined as integers; no float is
 * created at any point.
 *
 * Accepts one or two decimal places (PAC sends two) and a stray `$`. Returns
 * `null` for anything else rather than guessing — a price we cannot read is
 * not a price of zero.
 */
export function parseMoneyToCents(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /^\s*\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(raw);
  if (!match) return null;
  const dollars = Number.parseInt(match[1], 10);
  // "2" means twenty cents, not two. Pad before parsing, never after.
  const cents = match[2] ? Number.parseInt(match[2].padEnd(2, "0"), 10) : 0;
  if (!Number.isSafeInteger(dollars) || !Number.isSafeInteger(cents)) {
    return null;
  }
  return dollars * 100 + cents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cap(text: string): string {
  return text.slice(0, MAX_DETAIL_LENGTH);
}

/**
 * PAC's error body, whatever the status line claimed.
 *
 * Checked on **every** response, success-looking or not, because the API has
 * been observed returning this under both 200 and 404 for the same class of
 * bad request.
 */
function readApiError(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const error = body.error;
  if (!isRecord(error)) return null;
  const message = error.errorMessage;
  return typeof message === "string" && message.length > 0 ? message : null;
}

/* -------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------- */

function isNamed(value: unknown, name: string): boolean {
  return value instanceof Error && value.name === name;
}

type RawResponse =
  | { kind: "body"; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "network"; detail: string }
  | { kind: "unreadable"; status: number; detail: string };

async function attempt(url: string, apiKey: string): Promise<RawResponse> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "AUTH-KEY": apiKey, Accept: "application/json" },
      // A fresh signal per attempt — an expired one would abort the retry
      // before it left the process.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Rates change on the carrier's schedule, not ours, and this module has
      // its own cache with its own TTL. Two caches disagreeing about how stale
      // a price is would be worse than one.
      cache: "no-store",
    });

    const text = await response.text();
    try {
      return { kind: "body", status: response.status, body: JSON.parse(text) };
    } catch {
      return {
        kind: "unreadable",
        status: response.status,
        detail: cap(text) || `HTTP ${response.status} with an empty body`,
      };
    }
  } catch (error) {
    // `AbortSignal.timeout` rejects with a DOMException named "TimeoutError";
    // undici wraps some failures, so `cause` is checked too. Same test as
    // lib/email.ts, and for the same reason.
    const timedOut =
      isNamed(error, "TimeoutError") ||
      (error instanceof Error && isNamed(error.cause, "TimeoutError"));
    if (timedOut) return { kind: "timeout" };
    return {
      kind: "network",
      detail: cap(error instanceof Error ? error.message : "Unknown error."),
    };
  }
}

/**
 * One GET, with **one** retry and only on a network error.
 *
 * A socket that never opened costs nothing to try again. A timeout does not
 * get a second chance: the 2.5 s budget was chosen against a customer waiting
 * on a render, and retrying would double the worst case to five seconds to
 * chase an endpoint that has already shown it is not answering. Falling
 * through to the cached or fallback price is faster and just as correct.
 */
async function request(path: string, params: Record<string, string | number>) {
  const apiKey = process.env.AUSPOST_API_KEY;
  if (!apiKey) return { configured: false as const };

  const url = new URL(`${PAC_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let result = await attempt(url.toString(), apiKey);
  if (result.kind === "network") {
    result = await attempt(url.toString(), apiKey);
  }
  return { configured: true as const, result };
}

/** Collapses a transport outcome plus PAC's own error body into a PacResult. */
function toFailure<T>(result: RawResponse): PacResult<T> | null {
  switch (result.kind) {
    case "timeout":
      return {
        ok: false,
        reason: "timeout",
        status: null,
        detail: `No response in ${REQUEST_TIMEOUT_MS}ms.`,
      };
    case "network":
      return {
        ok: false,
        reason: "network_error",
        status: null,
        detail: result.detail,
      };
    case "unreadable":
      return {
        ok: false,
        reason: "http_error",
        status: result.status,
        detail: result.detail,
      };
    case "body": {
      // The body decides, not the status — see the file comment.
      const apiError = readApiError(result.body);
      if (apiError) {
        return {
          ok: false,
          reason: "api_error",
          status: result.status,
          detail: cap(apiError),
        };
      }
      if (result.status < 200 || result.status >= 300) {
        return {
          ok: false,
          reason: "http_error",
          status: result.status,
          detail: `HTTP ${result.status}`,
        };
      }
      return null; // Usable.
    }
  }
}

/* -------------------------------------------------------------------------
 * Parsers
 * ---------------------------------------------------------------------- */

/** `{services:{service: object | array}}` → a flat list, prices in cents. */
export function parseServices(body: unknown): PacService[] | null {
  if (!isRecord(body)) return null;
  const services = body.services;
  if (!isRecord(services)) return null;

  const raw = toArray(services.service as unknown);
  const out: PacService[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const priceCents = parseMoneyToCents(entry.price);
    if (priceCents === null) continue;
    if (typeof entry.code !== "string") continue;
    out.push({
      code: entry.code,
      name: typeof entry.name === "string" ? entry.name : entry.code,
      priceCents,
    });
  }
  return out.length > 0 ? out : null;
}

/** `{postage_result:{... costs:{cost: object | array}}}` → a calculation. */
export function parseCalculation(body: unknown): PacCalculation | null {
  if (!isRecord(body)) return null;
  const result = body.postage_result;
  if (!isRecord(result)) return null;

  const totalCents = parseMoneyToCents(result.total_cost);
  if (totalCents === null) return null;

  const costsNode = isRecord(result.costs) ? result.costs.cost : undefined;
  const costs: { item: string; cents: number }[] = [];
  for (const entry of toArray(costsNode as unknown)) {
    if (!isRecord(entry)) continue;
    const cents = parseMoneyToCents(entry.cost);
    if (cents === null) continue;
    costs.push({
      item: typeof entry.item === "string" ? entry.item : "",
      cents,
    });
  }

  return {
    serviceName:
      typeof result.service === "string" ? result.service : "Australia Post",
    deliveryTime:
      typeof result.delivery_time === "string" ? result.delivery_time : null,
    totalCents,
    costs,
  };
}

/* -------------------------------------------------------------------------
 * Endpoints
 * ---------------------------------------------------------------------- */

/** mm → cm, rounded **up**: a parcel is never smaller than we told them. */
function mmToCm(mm: number): number {
  return Math.max(1, Math.ceil(mm / 10));
}

/** g → kg with three decimals, rounded **up** for the same reason. */
function gToKg(grams: number): number {
  return Math.ceil(Math.max(0, grams)) / 1000;
}

function parcelParams(input: ParcelRequest) {
  return {
    from_postcode: input.fromPostcode,
    to_postcode: input.toPostcode,
    length: mmToCm(input.lengthMm),
    width: mmToCm(input.widthMm),
    height: mmToCm(input.heightMm),
    weight: gToKg(input.weightGrams),
  };
}

/** Which parcel services can carry this package, and for how much. */
export async function listParcelServices(
  input: ParcelRequest,
): Promise<PacResult<PacService[]>> {
  const response = await request(
    "parcel/domestic/service.json",
    parcelParams(input),
  );
  if (!response.configured) return notConfigured();

  const failure = toFailure<PacService[]>(response.result);
  if (failure) return failure;

  const body = (response.result as { body: unknown }).body;
  const services = parseServices(body);
  if (!services) {
    return {
      ok: false,
      reason: "bad_response",
      status: 200,
      detail: "No readable services in the response.",
    };
  }
  return { ok: true, value: services };
}

/** Price one named parcel service. */
export async function calculateParcel(
  input: ParcelRequest & { serviceCode: string },
): Promise<PacResult<PacCalculation>> {
  const response = await request("parcel/domestic/calculate.json", {
    ...parcelParams(input),
    service_code: input.serviceCode,
  });
  if (!response.configured) return notConfigured();

  const failure = toFailure<PacCalculation>(response.result);
  if (failure) return failure;

  const body = (response.result as { body: unknown }).body;
  const calculation = parseCalculation(body);
  if (!calculation) {
    return {
      ok: false,
      reason: "bad_response",
      status: 200,
      detail: "No readable postage_result in the response.",
    };
  }
  return { ok: true, value: calculation };
}

/**
 * Which letter services can carry this envelope.
 *
 * No postcodes: domestic letters are flat-rate nationally. The third dimension
 * is `thickness`, in millimetres — **not** `height`, whatever the API Explorer
 * says. Sending `height` gets "Please enter Thickness."
 */
export async function listLetterServices(
  input: LetterRequest,
): Promise<PacResult<PacService[]>> {
  const response = await request("letter/domestic/service.json", {
    length: Math.ceil(input.lengthMm),
    width: Math.ceil(input.widthMm),
    thickness: Math.ceil(input.thicknessMm),
    weight: Math.ceil(input.weightGrams),
  });
  if (!response.configured) return notConfigured();

  const failure = toFailure<PacService[]>(response.result);
  if (failure) return failure;

  const body = (response.result as { body: unknown }).body;
  const services = parseServices(body);
  if (!services) {
    return {
      ok: false,
      reason: "bad_response",
      status: 200,
      detail: "No readable services in the response.",
    };
  }
  return { ok: true, value: services };
}

/**
 * Price one named letter service.
 *
 * Takes only a service code and a weight — the letter calculator ignores
 * dimensions entirely, which is why `quote.ts` prices letters through here
 * rather than reading a price off the service list. Naming the code removes
 * any chance of the API deciding our package is a *Small* Letter and quoting
 * $1.70 for something we will hand over in a large mailer.
 */
export async function calculateLetter(input: {
  serviceCode: string;
  weightGrams: number;
}): Promise<PacResult<PacCalculation>> {
  const response = await request("letter/domestic/calculate.json", {
    service_code: input.serviceCode,
    weight: Math.ceil(input.weightGrams),
  });
  if (!response.configured) return notConfigured();

  const failure = toFailure<PacCalculation>(response.result);
  if (failure) return failure;

  const body = (response.result as { body: unknown }).body;
  const calculation = parseCalculation(body);
  if (!calculation) {
    return {
      ok: false,
      reason: "bad_response",
      status: 200,
      detail: "No readable postage_result in the response.",
    };
  }
  return { ok: true, value: calculation };
}

/** Dimensions of the letter mailer itself, for a `listLetterServices` probe. */
export function letterProbeDimensions(maxItemThicknessMm: number) {
  return {
    lengthMm: 240,
    widthMm: 165,
    thicknessMm: maxItemThicknessMm + PACKAGING.mailerThicknessMm,
  };
}

/** Exported for tests and diagnostics; not a tunable. */
export const PAC_REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
export const PAC_BASE_URL = PAC_BASE;
