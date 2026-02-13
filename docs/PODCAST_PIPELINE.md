# Reddit Comedy Podcast Pipeline

This pipeline builds a multi-speaker audio episode using subreddit posts and comments.

## Flow

1. Reddit API ingest (OAuth client credentials)
- Pull posts from each configured subreddit.
- Pull top comments per post.
- Optional one-off seed mode: pull one explicit Reddit thread URL/permalink plus top comments.
- Save source material to `sources.json`.

2. Script generation
- Optional pre-step: run LLM-driven persona research from web artifacts.
  - Per subject: query planning -> web search -> artifact fetch -> evidence extraction -> persona synthesis.
  - Supports provider fallback:
    - `serper` when `SERPER_API_KEY` is present
    - Brave web-search HTML extraction when Serper key is absent
    - `bing_rss` as final fallback
  - Produces speaker persona pack with style traits and grounded evidence claims.
- Build an LLM writer-room panel script with five speakers:
  - `HOST`
  - `POST_READER`
  - `COMMENT_READER`
  - `PANELIST_A`
  - `PANELIST_B`
- Use two passes:
  - draft generation
  - dialogue punch-up pass for stronger banter dynamics
- Optional writer architectures are supported:
  - `single_pass`
  - `draft_polish`
  - `beat_sheet_polish`
  - `planner_agents` (master planner + per-speaker persona agents)
- Writer guidance emphasizes conversation realism:
  - interruptions
  - callbacks
  - playful disagreements
  - speaker turn-balance
- `planner_agents` mode runtime:
  - Master planner emits the next action batch (who speaks next + objective + interaction type).
  - Persona workers generate only their own assigned lines.
  - When persona pack is provided, planner + workers receive role-specific researched traits.
  - Transcript is assembled in planner order so overlap and banter timing stay coherent.
- Conversation arbitration stage:
  - Assigns per-line timing (`startMs`, `endMs`) and overlap groups.
  - Grants/denies interruption overlap by priority, speaker cooldown, and simultaneous-speaker limit.
- Save script to `script.json` and `script.txt`.

3. Audio rendering
- Render each line through ElevenLabs per-line text-to-speech with the dialogue model (`eleven_v3` by default).
- Renderer adds per-line performance direction via `voice_settings`:
  - `stability`, `similarity_boost`, `style`, `speed`, `use_speaker_boost`
- Any bracket stage directions like `[laughs]` / `[clears throat]` are stripped before synthesis because many voices will literally speak them.
- If dialogue-model TTS fails (quota/model/validation), renderer falls back to the configured line-TTS model.
- Mix line stems with `ffmpeg` using per-line start offsets to preserve overlaps/interjections.
- Save final mixed MP3 (`episode-mix.mp3`) plus intermediate stems under `stems/`.
- Save `manifest.json`.

## Prerequisites

1. Populate these environment variables:
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`
- `ELEVENLABS_API_KEY`
- `OPENAI_API_KEY`
- `PODCAST_HOST_VOICE_ID`
- `PODCAST_POST_READER_VOICE_ID`
- `PODCAST_COMMENT_READER_VOICE_ID`
- `PODCAST_PANELIST_A_VOICE_ID`
- `PODCAST_PANELIST_B_VOICE_ID`

2. Optional:
- `PODCAST_WRITER_MODEL` (default `gpt-5-mini`)
- `PODCAST_RESEARCH_MODEL` (default `gpt-5-mini`)
- `PODCAST_RESEARCH_SEARCH_PROVIDER` (`auto` | `serper` | `bing_rss`, default `auto`)
- `SERPER_API_KEY` (optional, required only when forcing provider to `serper`)
- `PODCAST_PERSONA_SUBJECTS` (optional comma-separated subject list used by `podcast:build`)
- `PODCAST_WRITER_ARCHITECTURE` (`single_pass` | `draft_polish` | `beat_sheet_polish` | `planner_agents`, default `planner_agents`)
- `PODCAST_WRITER_REASONING_EFFORT` (`low` | `medium` | `high`, optional)
- `PODCAST_WRITER_TEMPERATURE` (optional)
- `PODCAST_DIALOGUE_MODEL_ID` (default `eleven_v3`)
- `PODCAST_LINE_TTS_MODEL_ID` (fallback model for per-line TTS when dialogue endpoint is unavailable, default `eleven_turbo_v2_5`)
- `PODCAST_OUTPUT_FORMAT` (default `mp3_44100_128`)

## Commands

List voices for your ElevenLabs account:

```bash
npm run podcast:list-voices
```

Build an episode:

```bash
npm run podcast:build -- \
  --subreddits AskReddit,funny,tifu \
  --postsPerSubreddit 2 \
  --commentsPerPost 3 \
  --targetMinutes 30 \
  --listing top \
  --topWindow day
```

Build from one ad hoc seed thread:

```bash
npm run podcast:build -- \
  --seedThread https://www.reddit.com/r/AskReddit/comments/abc123/example_title/ \
  --commentsPerPost 8 \
  --targetMinutes 20 \
  --personaSubjects "Conan O'Brien,Tig Notaro,Jon Stewart,Aubrey Plaza,Nathan Fielder"
```

When `--seedThread` is used, build output also includes:

- `seed-thread.raw.json` (full Reddit API payload for the seed thread)
- `seed-thread.normalized.json` (flattened comments + metadata)
- `seed-thread.tree.json` (reconstructed parent/child tree in reply order)
- Seed ingest attempts high coverage (`limit=1000`, `depth=15`) so metadata is preserved for most one-off threads.

Scrape one seed thread with full raw metadata preservation:

```bash
npm run reddit:scrape -- \
  --seedThread https://www.reddit.com/r/AskReddit/comments/abc123/example_title/ \
  --commentsLimit 500 \
  --depth 10 \
  --sort top
```

Notes:

- If `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are present, scraper uses OAuth.
- If credentials are absent, scraper falls back to public `reddit.com/.../.json` for one-off thread pulls.

Scrape output:

- `thread.raw.json` (full Reddit API response with post listing + full comments tree)
- `thread.normalized.json` (flattened comments with metadata + unresolved `more` ids)
- `thread.tree.json` (reconstructed parent/child tree for reply traversal)
- `thread.summary.json` (quick counts and identifiers)

Run standalone persona research and persist artifacts/evidence/profile outputs:

```bash
npm run podcast:research-persona -- \
  --subjects "Conan O'Brien,Tig Notaro,Jon Stewart" \
  --provider auto
```

Persona research output:

- `output/research/<run-id>/persona-pack.json`
- `output/research/<run-id>/runs/<subject>.json`
- `output/research/<run-id>/summary.md`

Output folder (default):

- `output/episodes/<episode-id>/`

Benchmark writer options (uses local Reddit-like fixtures and OpenAI key only):

```bash
npm run podcast:benchmark -- --targetMinutes 12 --runs 1
```

Test conversation architecture only (no ElevenLabs rendering):

```bash
npm run podcast:test-conversation -- \
  --architecture planner_agents \
  --targetMinutes 5 \
  --fixtureCount 2 \
  --name planner-agents-smoke
```

Test overlap audio mixing locally without API credits:

```bash
npm run podcast:test-overlap-mix-local
```

Benchmark output:

- `output/benchmarks/<run-id>/summary.md`
- `output/benchmarks/<run-id>/results.json`

## Publishing (S3 + Neon + website)

The repository includes a simple website:

- `/podcast/` for episode playback + transcript + artifacts
- `/system/` for an end-to-end pipeline diagram

Development mode (no cloud dependencies):

- Set `EPISODES_STORE=fs` (default)
- Episodes are loaded from `output/episodes/*`
- Audio and artifacts are served from `/local-episodes/...`

Production mode (publish assets + index in Neon):

1. Set `DATABASE_URL`, `AWS_REGION`, `PODCAST_S3_BUCKET`, and (recommended) `PODCAST_PUBLIC_BASE_URL`.
2. Run the migration:

```bash
npm run site:migrate
```

3. Publish an episode directory:

```bash
npm run site:publish-episode -- --episodeDir output/episodes/<episodeId>
```

4. Run the site using Postgres:

- Set `EPISODES_STORE=postgres`
- Start the server (`npm run dev`) and open `/podcast/`

## Safety and policy notes

- This implementation is for entertainment workflows.
- Respect subreddit rules, Reddit API terms, and content rights.
- The writer is instructed to avoid hateful/abusive output; still review generated material before publication.
