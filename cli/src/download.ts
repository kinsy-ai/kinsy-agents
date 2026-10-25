import fs from "node:fs";
import path from "node:path";
import { KinsyClient } from "./client.js";
import type { FileLink } from "./types.js";

export type ArtifactKind = "pptx" | "pdf" | "png";

const EXT: Record<ArtifactKind, string> = { pptx: "pptx", pdf: "pdf", png: "zip" };
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,118}$/;

// The server's filename when it is a plain basename, else <deck_id>.<ext>.
export function defaultOutPath(deckId: string, kind: ArtifactKind, filename: string | undefined): string {
  if (filename && SAFE_NAME.test(filename) && !filename.includes("..")) return filename;
  return `${deckId}.${EXT[kind]}`;
}

export type Saved = { path: string; filename: string; bytes: number };

// GET /v1/decks/{id}/files/{kind}?redirect=false for a fresh signed link,
// then fetch the bytes (without the bearer) and write them.
export async function downloadArtifact(
  client: KinsyClient,
  deckId: string,
  kind: ArtifactKind,
  outPath: string | undefined,
): Promise<Saved> {
  const link = await client.request<FileLink>(
    "GET",
    `/v1/decks/${encodeURIComponent(deckId)}/files/${kind}?redirect=false`,
  );
  const target = path.resolve(outPath ?? defaultOutPath(deckId, kind, link.filename));
  const data = await client.download(link.url);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return { path: target, filename: link.filename, bytes: data.length };
}

export function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
