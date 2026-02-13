import type { PodcastLine, PostWithComments } from "./types.js";

const HOST_INTROS = [
  "Welcome to Thread Theatre, where internet chaos meets panel commentary.",
  "Welcome back to Thread Theatre, the show where we turn Reddit drama into a comedy panel.",
  "This is Thread Theatre, your weekly walk through the strangest corners of Reddit."
];

const HOST_TRANSITIONS = [
  "First up, this post is absolutely unhinged in the best way.",
  "Next thread. The setup is simple and the consequences are ridiculous.",
  "Let us move to another post that somehow got even weirder."
];

const PANEL_REACTIONS_A = [
  "This feels like a life decision made with zero meetings and maximum confidence.",
  "The logic is broken, but the commitment is elite.",
  "Somewhere, a group chat is still arguing about this one."
];

const PANEL_REACTIONS_B = [
  "I respect the audacity, not the execution.",
  "That is not a red flag. That is a full marching band.",
  "I want a documentary, a sequel, and a follow-up thread."
];

const STOP_WORDS = new Set([
  "the",
  "and",
  "that",
  "with",
  "this",
  "from",
  "have",
  "what",
  "when",
  "your",
  "about",
  "just",
  "into",
  "they",
  "them",
  "then",
  "because",
  "would",
  "there",
  "could"
]);

interface ScriptOptions {
  subreddits: string[];
}

export function buildEpisodeScript(posts: PostWithComments[], options: ScriptOptions): PodcastLine[] {
  if (posts.length === 0) {
    throw new Error("Cannot build episode script with zero posts.");
  }

  const lines: PodcastLine[] = [];
  const intro = HOST_INTROS[seedIndex(options.subreddits.join("|"), HOST_INTROS.length)];

  lines.push({ speaker: "HOST", text: intro });
  lines.push({
    speaker: "HOST",
    text: `Tonight's source threads come from ${options.subreddits.map((s) => `r/${s}`).join(", ")}.`}
  );

  for (let index = 0; index < posts.length; index += 1) {
    const item = posts[index];
    const seed = `${item.post.id}:${index}`;

    lines.push({ speaker: "HOST", text: HOST_TRANSITIONS[seedIndex(seed, HOST_TRANSITIONS.length)] });
    lines.push({
      speaker: "POST_READER",
      text: `From r/${item.post.subreddit}, posted by u/${item.post.author}. Title: ${cleanForSpeech(
        item.post.title,
        180
      )}.`
    });

    if (item.post.body.trim().length > 0) {
      lines.push({
        speaker: "POST_READER",
        text: `Post details: ${cleanForSpeech(item.post.body, 260)}`
      });
    }

    const topic = inferTopic(item.post.title, item.post.body);
    const comments = item.comments.slice(0, 3);

    if (comments.length === 0) {
      lines.push({
        speaker: "COMMENT_READER",
        text: "No top comments loaded for this one, so the panel is reacting blind."
      });
    } else {
      for (const comment of comments) {
        lines.push({
          speaker: "COMMENT_READER",
          text: `Top reply from u/${comment.author}: ${cleanForSpeech(comment.body, 220)}`
        });
      }
    }

    lines.push({
      speaker: "PANELIST_A",
      text: `${PANEL_REACTIONS_A[seedIndex(`${seed}:A`, PANEL_REACTIONS_A.length)]} The keyword here is ${topic}.`
    });

    lines.push({
      speaker: "PANELIST_B",
      text: `${PANEL_REACTIONS_B[seedIndex(`${seed}:B`, PANEL_REACTIONS_B.length)]} The internet turned ${topic} into a competitive sport.`
    });

    lines.push({
      speaker: "HOST",
      text: "Final ruling from the panel: funny thread, questionable choices, ten out of ten for storytelling."
    });
  }

  lines.push({
    speaker: "HOST",
    text: "That is the show. If you want another round of thread theatre, we will be back with more posts and more chaos."
  });

  return lines.map((line) => ({
    ...line,
    text: normalizeWhitespace(line.text)
  }));
}

export function cleanForSpeech(text: string, maxChars: number): string {
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, "link removed");
  const withoutMarkdown = withoutUrls
    .replace(/[`*_>#~]/g, " ")
    .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (withoutMarkdown.length <= maxChars) {
    return withoutMarkdown;
  }

  return `${withoutMarkdown.slice(0, maxChars - 3).trim()}...`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function inferTopic(title: string, body: string): string {
  const text = `${title} ${body}`.toLowerCase();
  const words = text.match(/[a-z]{4,}/g) ?? [];

  const candidates = words.filter((word) => !STOP_WORDS.has(word));
  if (candidates.length === 0) {
    return "chaos";
  }

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function seedIndex(seed: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }

  return Math.abs(hash) % size;
}
