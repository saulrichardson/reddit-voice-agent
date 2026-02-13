import { z } from "zod";

export const episodeSpeakerSchema = z.enum([
  "HOST",
  "POST_READER",
  "COMMENT_READER",
  "PANELIST_A",
  "PANELIST_B"
]);

export type EpisodeSpeaker = z.infer<typeof episodeSpeakerSchema>;

export const episodeScriptLineSchema = z.object({
  lineId: z.string(),
  speaker: episodeSpeakerSchema,
  text: z.string(),
  interaction: z.string().optional(),
  respondsToLineId: z.string().nullable().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  priorityScore: z.number().optional(),
  overlapGroupId: z.string().nullable().optional(),
  interruptsLineId: z.string().nullable().optional(),
  arbitrationReason: z.string().optional()
});

export type EpisodeScriptLine = z.infer<typeof episodeScriptLineSchema>;

export const episodeManifestSchema = z.object({
  episodeId: z.string(),
  generatedAtIso: z.string(),
  subreddits: z.array(z.string()).default([]),
  sourceCount: z.number().int().nonnegative().optional(),
  lineCount: z.number().int().nonnegative().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  chunkFiles: z.array(z.string()).default([])
});

export type EpisodeManifest = z.infer<typeof episodeManifestSchema>;

export type EpisodeSourcePost = {
  id?: string;
  subreddit?: string;
  title?: string;
  author?: string;
  permalink?: string;
  createdUtc?: number;
  score?: number;
  numComments?: number;
};

export type EpisodeSource = {
  post?: EpisodeSourcePost;
};

export type EpisodeSummary = {
  id: string;
  title: string;
  generatedAtIso: string;
  subreddits: string[];
  audioUrls: string[];
  stats: {
    lineCount?: number;
    chunkCount?: number;
    sourceCount?: number;
  };
  sourceUrl?: string;
};

export type EpisodeDetail = EpisodeSummary & {
  artifacts: Record<string, string>;
  sources?: EpisodeSource[];
  script?: EpisodeScriptLine[];
};

