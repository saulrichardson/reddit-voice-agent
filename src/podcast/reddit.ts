import type {
  ListingType,
  PostWithComments,
  RedditComment,
  RedditPost,
  RedditThreadSnapshot,
  RedditThreadSnapshotComment,
  RedditThreadTreeNode,
  TopTimeWindow
} from "./types.js";

interface RedditTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface RedditListingChild {
  kind?: string;
  data?: Record<string, unknown>;
}

interface RedditListing {
  data?: {
    children?: RedditListingChild[];
  };
}

interface RedditClientConfig {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

interface MoreChildRequest {
  linkId: string;
  childrenIds: string[];
}

interface MoreChildResult {
  things: RedditListingChild[];
  unresolvedIds: string[];
}

interface ThreadBuildState {
  commentsById: Map<string, RedditThreadSnapshotComment>;
  sequenceById: Map<string, number>;
  sequenceCursor: number;
  moreQueue: MoreNode[];
  unresolvedMoreChildrenIds: Set<string>;
  requestedMoreChildrenIds: Set<string>;
}

interface MoreNode {
  linkId: string;
  childrenIds: string[];
}

interface MoreChildrenResponse {
  json?: {
    data?: {
      things?: RedditListingChild[];
    };
  };
}

export class RedditClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userAgent: string;
  private accessToken: string | null = null;

  constructor(config: RedditClientConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.userAgent = config.userAgent;
  }

  async loadPostsWithComments(input: {
    subreddits: string[];
    listing: ListingType;
    topWindow: TopTimeWindow;
    postsPerSubreddit: number;
    commentsPerPost: number;
  }): Promise<PostWithComments[]> {
    await this.ensureAccessToken();

    const allPosts: PostWithComments[] = [];

    for (const subreddit of input.subreddits) {
      const posts = await this.fetchSubredditPosts({
        subreddit,
        listing: input.listing,
        topWindow: input.topWindow,
        limit: input.postsPerSubreddit
      });

      for (const post of posts) {
        const comments = await this.fetchPostComments(post.permalink, input.commentsPerPost);
        allPosts.push({ post, comments });
      }
    }

    return allPosts;
  }

  async loadSeedPostWithComments(input: {
    seedThread: string;
    commentsPerPost: number;
  }): Promise<PostWithComments[]> {
    const snapshot = await this.loadSeedThreadSnapshot({
      seedThread: input.seedThread,
      commentsLimit: Math.max(32, input.commentsPerPost * 20),
      sort: "top",
      depth: 8
    });
    return [snapshotToPostWithComments(snapshot, input.commentsPerPost)];
  }

  async loadSeedThreadSnapshot(input: {
    seedThread: string;
    commentsLimit: number;
    sort?: "top" | "new" | "best" | "controversial";
    depth?: number;
  }): Promise<RedditThreadSnapshot> {
    await this.ensureAccessToken();

    const permalink = normalizeSeedPermalink(input.seedThread);
    const query = new URLSearchParams({
      limit: String(Math.max(1, Math.min(1000, input.commentsLimit))),
      sort: input.sort ?? "top",
      raw_json: "1"
    });

    if (typeof input.depth === "number" && Number.isFinite(input.depth) && input.depth > 0) {
      query.set("depth", String(Math.min(15, Math.floor(input.depth))));
    }

    const response = await this.redditGet<unknown[]>(`${permalink}.json?${query.toString()}`);
    return buildSeedThreadSnapshotFromPayload({
      seedThreadInput: input.seedThread,
      permalink,
      payload: response,
      resolveMoreChildren: async (request) => this.fetchMoreChildrenOauth(request)
    });
  }

  private async fetchMoreChildrenOauth(request: MoreChildRequest): Promise<MoreChildResult> {
    const query = new URLSearchParams({
      api_type: "json",
      raw_json: "1",
      link_id: request.linkId,
      children: request.childrenIds.join(",")
    });

    const payload = await this.redditGet<MoreChildrenResponse>(`/api/morechildren.json?${query.toString()}`);
    const things = payload.json?.data?.things ?? [];

    return {
      things,
      unresolvedIds: collectUnresolvedIdsFromMoreThings(things)
    };
  }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken) {
      return;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials" });

    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.userAgent,
        Accept: "application/json"
      },
      body
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Reddit OAuth token request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as RedditTokenResponse;
    if (!payload.access_token) {
      throw new Error("Reddit OAuth token response did not include access_token.");
    }

    this.accessToken = payload.access_token;
  }

  private async fetchSubredditPosts(input: {
    subreddit: string;
    listing: ListingType;
    topWindow: TopTimeWindow;
    limit: number;
  }): Promise<RedditPost[]> {
    const query = new URLSearchParams({
      limit: String(input.limit),
      raw_json: "1"
    });

    if (input.listing === "top") {
      query.set("t", input.topWindow);
    }

    const listing = await this.redditGet<RedditListing>(
      `/r/${encodeURIComponent(input.subreddit)}/${input.listing}.json?${query.toString()}`
    );

    const children = listing.data?.children ?? [];
    const posts: RedditPost[] = [];

    for (const child of children) {
      if (child.kind !== "t3" || !child.data) {
        continue;
      }

      const data = child.data;
      const post = toPost(data, input.subreddit);
      if (!post) {
        continue;
      }

      posts.push(post);
    }

    return posts;
  }

  private async fetchPostComments(permalink: string, limit: number): Promise<RedditComment[]> {
    const query = new URLSearchParams({
      limit: String(limit),
      sort: "top",
      raw_json: "1"
    });

    const response = await this.redditGet<unknown[]>(`${permalink}.json?${query.toString()}`);
    if (!Array.isArray(response) || response.length < 2) {
      return [];
    }

    const commentsListing = response[1] as RedditListing;
    return parseCommentsFromListing(commentsListing);
  }

  private async redditGet<T>(pathWithQuery: string): Promise<T> {
    if (!this.accessToken) {
      throw new Error("Reddit client missing access token. Call ensureAccessToken first.");
    }

    const url = `https://oauth.reddit.com${pathWithQuery}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "User-Agent": this.userAgent,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Reddit API request failed (${response.status}) for ${pathWithQuery}: ${text}`);
    }

    return (await response.json()) as T;
  }
}

export async function loadSeedThreadSnapshotFromPublicEndpoint(input: {
  seedThread: string;
  commentsLimit: number;
  sort?: "top" | "new" | "best" | "controversial";
  depth?: number;
  userAgent?: string;
}): Promise<RedditThreadSnapshot> {
  const permalink = normalizeSeedPermalink(input.seedThread);
  const query = new URLSearchParams({
    limit: String(Math.max(1, Math.min(1000, input.commentsLimit))),
    sort: input.sort ?? "top",
    raw_json: "1"
  });

  if (typeof input.depth === "number" && Number.isFinite(input.depth) && input.depth > 0) {
    query.set("depth", String(Math.min(15, Math.floor(input.depth))));
  }

  const userAgent = input.userAgent ?? "voice-agent/0.1 by seed-scraper";
  const url = `https://www.reddit.com${permalink}.json?${query.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Public Reddit thread request failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as unknown;
  return buildSeedThreadSnapshotFromPayload({
    seedThreadInput: input.seedThread,
    permalink,
    payload,
    resolveMoreChildren: async (request) => fetchMoreChildrenPublic({ request, userAgent })
  });
}

export function snapshotToPostWithComments(
  snapshot: RedditThreadSnapshot,
  commentsPerPost: number
): PostWithComments {
  const topRenderableComments = snapshot.commentsFlattened
    .filter(
      (comment) =>
        typeof comment.body === "string" &&
        comment.body !== "[deleted]" &&
        comment.body !== "[removed]"
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, commentsPerPost)
    .map<RedditComment>((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body ?? "",
      score: comment.score,
      createdUtc: comment.createdUtc
    }));

  return {
    post: snapshot.post,
    comments: topRenderableComments
  };
}

function parseCommentsFromListing(listing: RedditListing): RedditComment[] {
  const children = listing.data?.children ?? [];
  const comments: RedditComment[] = [];

  for (const child of children) {
    if (child.kind !== "t1" || !child.data) {
      continue;
    }

    const comment = toComment(child.data);
    if (!comment) {
      continue;
    }

    comments.push(comment);
  }

  return comments;
}

export function normalizeSeedPermalink(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Seed thread is empty. Pass a Reddit thread URL or permalink.");
  }

  if (raw.startsWith("/r/")) {
    return stripTrailingSlash(raw);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "Seed thread must be a Reddit URL or permalink like /r/subreddit/comments/postId/title."
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname !== "reddit.com" &&
    hostname !== "www.reddit.com" &&
    hostname !== "old.reddit.com" &&
    hostname !== "np.reddit.com"
  ) {
    throw new Error("Seed thread URL must point to reddit.com.");
  }

  const path = stripTrailingSlash(parsed.pathname);
  if (!/^\/r\/[^\/]+\/comments\/[^\/]+/i.test(path)) {
    throw new Error(
      "Seed thread URL must follow /r/<subreddit>/comments/<post_id>/... format."
    );
  }

  return path;
}

export async function buildSeedThreadSnapshotFromPayload(input: {
  seedThreadInput: string;
  permalink: string;
  payload: unknown;
  resolveMoreChildren?: (request: MoreChildRequest) => Promise<MoreChildResult>;
}): Promise<RedditThreadSnapshot> {
  if (!Array.isArray(input.payload) || input.payload.length < 2) {
    throw new Error("Seed thread response did not include post + comments listings.");
  }

  const postListing = input.payload[0] as RedditListing;
  const postChild = postListing.data?.children?.find(
    (child) => child.kind === "t3" && child.data
  );
  if (!postChild?.data) {
    throw new Error("Seed thread response did not include a valid post object.");
  }

  const fallbackSubreddit = extractSubredditFromPermalink(input.permalink) ?? "unknown";
  const post = toPost(postChild.data, fallbackSubreddit);
  if (!post) {
    throw new Error("Unable to parse seed thread post payload.");
  }

  const linkId = `t3_${post.id}`;
  const commentsListing = input.payload[1] as RedditListing;
  const state = createThreadBuildState();

  ingestListingChildren({
    children: commentsListing.data?.children ?? [],
    linkId,
    state
  });

  if (input.resolveMoreChildren) {
    await expandMoreChildren({
      linkId,
      state,
      resolveMoreChildren: input.resolveMoreChildren
    });
  }

  const commentsFlattened = [...state.commentsById.values()].sort((a, b) => a.sequence - b.sequence);
  const commentTree = buildCommentTree(commentsFlattened, linkId);

  return {
    seedThreadInput: input.seedThreadInput,
    permalink: input.permalink,
    fetchedAtIso: new Date().toISOString(),
    post,
    postRaw: { ...postChild.data },
    commentsFlattened,
    commentTree,
    unresolvedMoreChildrenIds: [...state.unresolvedMoreChildrenIds],
    rawThread: input.payload
  };
}

function createThreadBuildState(): ThreadBuildState {
  return {
    commentsById: new Map(),
    sequenceById: new Map(),
    sequenceCursor: 0,
    moreQueue: [],
    unresolvedMoreChildrenIds: new Set(),
    requestedMoreChildrenIds: new Set()
  };
}

function ensureSequence(state: ThreadBuildState, commentId: string): number {
  const existing = state.sequenceById.get(commentId);
  if (existing !== undefined) {
    return existing;
  }

  const next = state.sequenceCursor;
  state.sequenceCursor += 1;
  state.sequenceById.set(commentId, next);
  return next;
}

function enqueueMoreNode(
  state: ThreadBuildState,
  node: { childrenIds: string[]; linkId: string | null }
): void {
  const linkId = node.linkId;
  if (!linkId || node.childrenIds.length === 0) {
    return;
  }

  for (const childId of node.childrenIds) {
    ensureSequence(state, childId);
  }

  state.moreQueue.push({
    linkId,
    childrenIds: node.childrenIds
  });
}

function ingestListingChildren(input: {
  children: RedditListingChild[];
  linkId: string;
  state: ThreadBuildState;
}): void {
  for (const child of input.children) {
    if (!child.data || typeof child.data !== "object") {
      continue;
    }

    if (child.kind === "t1") {
      upsertSnapshotComment({
        data: child.data,
        state: input.state,
        fallbackLinkId: input.linkId
      });

      const replies = child.data.replies;
      if (replies && typeof replies === "object") {
        const nested = replies as RedditListing;
        ingestListingChildren({
          children: nested.data?.children ?? [],
          linkId: input.linkId,
          state: input.state
        });
      }
      continue;
    }

    if (child.kind === "more") {
      const moreNode = parseMoreNode(child.data, input.linkId);
      if (moreNode) {
        enqueueMoreNode(input.state, moreNode);
      }
    }
  }
}

function upsertSnapshotComment(input: {
  data: Record<string, unknown>;
  state: ThreadBuildState;
  fallbackLinkId: string;
}): void {
  const comment = toSnapshotComment(input.data, input.fallbackLinkId, input.state);
  if (!comment) {
    return;
  }

  const existing = input.state.commentsById.get(comment.id);
  if (!existing) {
    input.state.commentsById.set(comment.id, comment);
    return;
  }

  const mergedRaw = {
    ...existing.rawMetadata,
    ...comment.rawMetadata
  };

  input.state.commentsById.set(comment.id, {
    ...existing,
    ...comment,
    sequence: Math.min(existing.sequence, comment.sequence),
    childrenIds: mergeUnique(existing.childrenIds, comment.childrenIds),
    rawMetadata: mergedRaw
  });
}

async function expandMoreChildren(input: {
  linkId: string;
  state: ThreadBuildState;
  resolveMoreChildren: (request: MoreChildRequest) => Promise<MoreChildResult>;
}): Promise<void> {
  let guard = 0;
  const maxIterations = 200;

  while (input.state.moreQueue.length > 0 && guard < maxIterations) {
    guard += 1;
    const node = input.state.moreQueue.shift() as MoreNode;
    const requestableIds = node.childrenIds.filter(
      (id) => !input.state.requestedMoreChildrenIds.has(id)
    );

    if (requestableIds.length === 0) {
      continue;
    }

    const batches = chunk(requestableIds, 100);
    for (const batch of batches) {
      batch.forEach((id) => input.state.requestedMoreChildrenIds.add(id));

      try {
        const result = await input.resolveMoreChildren({
          linkId: node.linkId || input.linkId,
          childrenIds: batch
        });

        ingestListingChildren({
          children: result.things,
          linkId: node.linkId || input.linkId,
          state: input.state
        });

        for (const unresolvedId of result.unresolvedIds) {
          if (!input.state.commentsById.has(unresolvedId)) {
            input.state.unresolvedMoreChildrenIds.add(unresolvedId);
          }
        }
      } catch {
        for (const id of batch) {
          if (!input.state.commentsById.has(id)) {
            input.state.unresolvedMoreChildrenIds.add(id);
          }
        }
      }
    }
  }

  while (input.state.moreQueue.length > 0) {
    const node = input.state.moreQueue.shift() as MoreNode;
    for (const id of node.childrenIds) {
      if (!input.state.commentsById.has(id)) {
        input.state.unresolvedMoreChildrenIds.add(id);
      }
    }
  }
}

function parseMoreNode(
  data: Record<string, unknown>,
  fallbackLinkId: string
): { childrenIds: string[]; linkId: string | null } | null {
  const childrenRaw = data.children;
  if (!Array.isArray(childrenRaw)) {
    return null;
  }

  const childrenIds = childrenRaw
    .map((value) => (typeof value === "string" ? value : null))
    .filter((value): value is string => Boolean(value));

  if (childrenIds.length === 0) {
    return null;
  }

  const linkId = asString(data.link_id) ?? fallbackLinkId;
  return { childrenIds, linkId };
}

function toSnapshotComment(
  data: Record<string, unknown>,
  fallbackLinkId: string,
  state: ThreadBuildState
): RedditThreadSnapshotComment | null {
  const id = asString(data.id);
  if (!id) {
    return null;
  }

  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "replies") {
      continue;
    }
    metadata[key] = value;
  }

  const parentId = asString(data.parent_id);
  const linkId = asString(data.link_id) ?? fallbackLinkId;
  const childrenIds = extractReplyChildrenIds(data.replies);
  const sequence = ensureSequence(state, id);

  return {
    id,
    parentId,
    parentCommentId: normalizeParentCommentId(parentId),
    linkId,
    depth: asNumber(data.depth) ?? 0,
    sequence,
    childrenIds,
    author: asString(data.author) ?? "unknown",
    body: typeof data.body === "string" ? data.body : null,
    score: asNumber(data.score) ?? 0,
    createdUtc: asNumber(data.created_utc) ?? 0,
    permalink: asString(data.permalink),
    isSubmitter: asBoolean(data.is_submitter) ?? false,
    stickied: asBoolean(data.stickied) ?? false,
    distinguished: asString(data.distinguished),
    edited: normalizeEditedField(data.edited),
    rawMetadata: metadata
  };
}

function extractReplyChildrenIds(replies: unknown): string[] {
  if (!replies || typeof replies !== "object") {
    return [];
  }

  const listing = replies as RedditListing;
  const children = listing.data?.children ?? [];
  const ids: string[] = [];

  for (const child of children) {
    if (!child.data || typeof child.data !== "object") {
      continue;
    }

    if (child.kind === "t1") {
      const id = asString(child.data.id);
      if (id) {
        ids.push(id);
      }
      continue;
    }

    if (child.kind === "more") {
      const moreChildren = child.data.children;
      if (Array.isArray(moreChildren)) {
        for (const value of moreChildren) {
          if (typeof value === "string") {
            ids.push(value);
          }
        }
      }
    }
  }

  return dedupe(ids);
}

function normalizeParentCommentId(parentId: string | null): string | null {
  if (!parentId) {
    return null;
  }
  const match = /^t1_(.+)$/i.exec(parentId);
  return match?.[1] ?? null;
}

function buildCommentTree(
  commentsFlattened: RedditThreadSnapshotComment[],
  linkId: string
): RedditThreadTreeNode[] {
  const nodeById = new Map<string, RedditThreadTreeNode>();
  for (const comment of commentsFlattened) {
    nodeById.set(comment.id, { comment, children: [] });
  }

  const roots: RedditThreadTreeNode[] = [];

  for (const comment of commentsFlattened) {
    const node = nodeById.get(comment.id) as RedditThreadTreeNode;
    const parentCommentId = comment.parentCommentId;

    if (!parentCommentId) {
      roots.push(node);
      continue;
    }

    const parentNode = nodeById.get(parentCommentId);
    if (!parentNode) {
      roots.push(node);
      continue;
    }

    parentNode.children.push(node);
  }

  const sortNodes = (nodes: RedditThreadTreeNode[]) => {
    nodes.sort((a, b) => a.comment.sequence - b.comment.sequence);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(roots);

  // If root detection missed because parent was link id prefix, keep deterministic order.
  if (roots.length === 0) {
    return commentsFlattened
      .filter((comment) => comment.parentId === linkId)
      .map((comment) => nodeById.get(comment.id) as RedditThreadTreeNode)
      .sort((a, b) => a.comment.sequence - b.comment.sequence);
  }

  return roots;
}

async function fetchMoreChildrenPublic(input: {
  request: MoreChildRequest;
  userAgent: string;
}): Promise<MoreChildResult> {
  const query = new URLSearchParams({
    api_type: "json",
    raw_json: "1",
    link_id: input.request.linkId,
    children: input.request.childrenIds.join(",")
  });

  const url = `https://www.reddit.com/api/morechildren.json?${query.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": input.userAgent,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Public morechildren request failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as MoreChildrenResponse;
  const things = payload.json?.data?.things ?? [];
  return {
    things,
    unresolvedIds: collectUnresolvedIdsFromMoreThings(things)
  };
}

function collectUnresolvedIdsFromMoreThings(things: RedditListingChild[]): string[] {
  const unresolved: string[] = [];
  for (const thing of things) {
    if (thing.kind !== "more" || !thing.data) {
      continue;
    }

    const children = thing.data.children;
    if (!Array.isArray(children)) {
      continue;
    }

    for (const child of children) {
      if (typeof child === "string") {
        unresolved.push(child);
      }
    }
  }

  return dedupe(unresolved);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeUnique(a: string[], b: string[]): string[] {
  return dedupe([...a, ...b]);
}

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }
  return pathname.replace(/\/+$/, "");
}

function extractSubredditFromPermalink(permalink: string): string | null {
  const match = /^\/r\/([^\/]+)\/comments\/[^\/]+/i.exec(permalink);
  return match?.[1] ?? null;
}

function normalizeEditedField(value: unknown): boolean | number | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toPost(data: Record<string, unknown>, fallbackSubreddit: string): RedditPost | null {
  const id = asString(data.id);
  const title = asString(data.title);
  const permalink = asString(data.permalink);

  if (!id || !title || !permalink) {
    return null;
  }

  return {
    id,
    subreddit: asString(data.subreddit) ?? fallbackSubreddit,
    title,
    body: asString(data.selftext) ?? "",
    author: asString(data.author) ?? "unknown",
    permalink,
    score: asNumber(data.score) ?? 0,
    numComments: asNumber(data.num_comments) ?? 0,
    over18: asBoolean(data.over_18) ?? false,
    createdUtc: asNumber(data.created_utc) ?? 0
  };
}

function toComment(data: Record<string, unknown>): RedditComment | null {
  const id = asString(data.id);
  const body = asString(data.body);

  if (!id || !body || body === "[deleted]" || body === "[removed]") {
    return null;
  }

  return {
    id,
    author: asString(data.author) ?? "unknown",
    body,
    score: asNumber(data.score) ?? 0,
    createdUtc: asNumber(data.created_utc) ?? 0
  };
}

function asString(input: unknown): string | null {
  return typeof input === "string" && input.trim().length > 0 ? input : null;
}

function asNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function asBoolean(input: unknown): boolean | null {
  return typeof input === "boolean" ? input : null;
}
