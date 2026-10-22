import type { FastifyRequest } from "fastify";
import type { ResponseFormat } from "@castellan/shared";

/** An integer from a query or body value; `fallback` when it is missing or not a number. */
export const int = (v: unknown, fallback: number) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Math.trunc(Number(v)));

/** The request asks for the compact text form (`?format=text`). */
export const wantsText = (req: FastifyRequest) => (req.query as { format?: ResponseFormat })?.format === "text";
