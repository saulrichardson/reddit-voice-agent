import { readFileSync } from "node:fs";

export function readJsonFile<T>(filePath: string): T {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}
