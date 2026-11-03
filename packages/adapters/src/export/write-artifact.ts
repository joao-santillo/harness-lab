import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WrittenArtifact {
  readonly path: string;
  readonly mediaType: string;
  readonly hash: string;
}

export async function writeArtifact(
  directory: string,
  filename: string,
  content: string,
  mediaType: string,
): Promise<WrittenArtifact> {
  const path = join(directory, filename);
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  return { path, mediaType, hash: createHash("sha256").update(content).digest("hex") };
}