import { config as loadDotenv } from "dotenv";

loadDotenv();

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list ElevenLabs voices (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    voices?: Array<{ voice_id?: string; name?: string; category?: string }>;
  };

  const voices = payload.voices ?? [];
  if (voices.length === 0) {
    throw new Error("No ElevenLabs voices returned for the account.");
  }

  // eslint-disable-next-line no-console
  console.log("voice_id,name,category");
  for (const voice of voices) {
    const id = voice.voice_id ?? "";
    const name = voice.name ?? "";
    const category = voice.category ?? "";
    const csv = [id, name, category].map((value) => `"${value.replace(/"/g, "\"\"")}"`).join(",");
    // eslint-disable-next-line no-console
    console.log(csv);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
