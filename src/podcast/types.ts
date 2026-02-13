export type ListingType = "hot" | "new" | "top";
export type TopTimeWindow = "hour" | "day" | "week" | "month" | "year" | "all";

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  body: string;
  author: string;
  permalink: string;
  score: number;
  numComments: number;
  over18: boolean;
  createdUtc: number;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
}

export interface PostWithComments {
  post: RedditPost;
  comments: RedditComment[];
}

export interface RedditThreadSnapshotComment {
  id: string;
  parentId: string | null;
  parentCommentId: string | null;
  linkId: string | null;
  depth: number;
  sequence: number;
  childrenIds: string[];
  author: string;
  body: string | null;
  score: number;
  createdUtc: number;
  permalink: string | null;
  isSubmitter: boolean;
  stickied: boolean;
  distinguished: string | null;
  edited: boolean | number | null;
  rawMetadata: Record<string, unknown>;
}

export interface RedditThreadTreeNode {
  comment: RedditThreadSnapshotComment;
  children: RedditThreadTreeNode[];
}

export interface RedditThreadSnapshot {
  seedThreadInput: string;
  permalink: string;
  fetchedAtIso: string;
  post: RedditPost;
  postRaw: Record<string, unknown>;
  commentsFlattened: RedditThreadSnapshotComment[];
  commentTree: RedditThreadTreeNode[];
  unresolvedMoreChildrenIds: string[];
  rawThread: unknown;
}

export type PodcastSpeaker =
  | "HOST"
  | "POST_READER"
  | "COMMENT_READER"
  | "PANELIST_A"
  | "PANELIST_B";

export type PodcastInteraction =
  | "interrupt"
  | "challenge"
  | "support"
  | "callback"
  | "transition"
  | "react";

export interface PodcastLine {
  lineId?: string;
  speaker: PodcastSpeaker;
  text: string;
  interaction?: PodcastInteraction;
  respondsToLineId?: string | null;
  arbitrationReason?: string;
  priorityScore?: number;
  startMs?: number;
  endMs?: number;
  overlapGroupId?: string | null;
  interruptsLineId?: string | null;
}

export interface EpisodeManifest {
  episodeId: string;
  generatedAtIso: string;
  subreddits: string[];
  sourceCount: number;
  lineCount: number;
  chunkCount: number;
  chunkFiles: string[];
}

export interface EpisodeBuildOptions {
  subreddits: string[];
  postsPerSubreddit: number;
  commentsPerPost: number;
  listing: ListingType;
  topWindow: TopTimeWindow;
  outputDir: string;
  episodeId?: string;
  targetMinutes: number;
  seedThread?: string;
  personaSubjects?: string[];
}
