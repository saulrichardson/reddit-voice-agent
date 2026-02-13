import { execFile as execFileCb } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { mixPreRenderedStems } from "./dialogueRender.js";

const execFile = promisify(execFileCb);

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[]): { outputDir: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected token ${token}. Use --key value format.`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }

  return {
    outputDir: path.resolve(process.cwd(), args.outputDir ?? `output/examples/overlap-mix-local-${timestampSlug()}`)
  };
}

async function ensureFfmpeg(): Promise<void> {
  try {
    await execFile("ffmpeg", ["-version"]);
  } catch {
    throw new Error("ffmpeg is required for local overlap mix test but was not found on PATH.");
  }
}

async function generateTone(filePath: string, frequencyHz: number, durationSeconds: number): Promise<void> {
  await execFile("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequencyHz}:duration=${durationSeconds}`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    filePath
  ]);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await ensureFfmpeg();

  await mkdir(options.outputDir, { recursive: true });

  const toneA = path.resolve(options.outputDir, "tone-a.mp3");
  const toneB = path.resolve(options.outputDir, "tone-b.mp3");
  const mixPath = path.resolve(options.outputDir, "overlap-mix.mp3");

  await generateTone(toneA, 320, 1.6);
  await generateTone(toneB, 640, 1.3);

  await mixPreRenderedStems({
    stems: [
      { filePath: toneA, startMs: 0, volume: 0.9 },
      { filePath: toneB, startMs: 650, volume: 1.0 }
    ],
    outPath: mixPath
  });

  await access(mixPath);

  // eslint-disable-next-line no-console
  console.log(`[overlap-mix-local] generated: ${mixPath}`);
  // eslint-disable-next-line no-console
  console.log(`[overlap-mix-local] stems: ${toneA}, ${toneB}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
