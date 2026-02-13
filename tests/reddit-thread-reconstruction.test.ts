import { describe, expect, it } from "vitest";
import { buildSeedThreadSnapshotFromPayload } from "../src/podcast/reddit.js";

function postListing(): unknown {
  return {
    data: {
      children: [
        {
          kind: "t3",
          data: {
            id: "post1",
            subreddit: "AskReddit",
            title: "Seed post",
            selftext: "Body",
            author: "op",
            permalink: "/r/AskReddit/comments/post1/seed_post/",
            score: 42,
            num_comments: 4,
            over_18: false,
            created_utc: 1
          }
        }
      ]
    }
  };
}

function comment(data: Record<string, unknown>): { kind: string; data: Record<string, unknown> } {
  return { kind: "t1", data };
}

function more(children: string[], linkId = "t3_post1"): { kind: string; data: Record<string, unknown> } {
  return {
    kind: "more",
    data: {
      id: "more_x",
      parent_id: linkId,
      link_id: linkId,
      children
    }
  };
}

describe("reddit thread reconstruction", () => {
  it("expands morechildren and keeps deterministic reply ordering", async () => {
    const payload = [
      postListing(),
      {
        data: {
          children: [
            comment({
              id: "a",
              parent_id: "t3_post1",
              link_id: "t3_post1",
              depth: 0,
              author: "u_a",
              body: "root A",
              score: 10,
              created_utc: 10,
              replies: {
                data: {
                  children: [more(["c"], "t3_post1")]
                }
              }
            }),
            comment({
              id: "b",
              parent_id: "t3_post1",
              link_id: "t3_post1",
              depth: 0,
              author: "u_b",
              body: "root B",
              score: 9,
              created_utc: 11,
              replies: ""
            }),
            more(["d"], "t3_post1")
          ]
        }
      }
    ];

    const snapshot = await buildSeedThreadSnapshotFromPayload({
      seedThreadInput: "/r/AskReddit/comments/post1/seed_post/",
      permalink: "/r/AskReddit/comments/post1/seed_post",
      payload,
      resolveMoreChildren: async (request) => {
        const things: Array<{ kind: string; data: Record<string, unknown> }> = [];
        if (request.childrenIds.includes("c")) {
          things.push(
            comment({
              id: "c",
              parent_id: "t1_a",
              link_id: "t3_post1",
              depth: 1,
              author: "u_c",
              body: "reply to A",
              score: 7,
              created_utc: 12,
              replies: ""
            })
          );
        }
        if (request.childrenIds.includes("d")) {
          things.push(
            comment({
              id: "d",
              parent_id: "t3_post1",
              link_id: "t3_post1",
              depth: 0,
              author: "u_d",
              body: "root D",
              score: 5,
              created_utc: 13,
              replies: ""
            })
          );
        }

        return { things, unresolvedIds: [] };
      }
    });

    expect(snapshot.commentsFlattened.map((item) => item.id).sort()).toEqual(["a", "b", "c", "d"]);
    const sequences = snapshot.commentsFlattened.map((item) => item.sequence);
    expect([...sequences].sort((left, right) => left - right)).toEqual(sequences);
    expect(snapshot.unresolvedMoreChildrenIds).toEqual([]);
    expect(snapshot.commentTree.map((node) => node.comment.id)).toEqual(["a", "b", "d"]);
    expect(snapshot.commentTree[0]?.children.map((node) => node.comment.id)).toEqual(["c"]);
  });

  it("tracks unresolved morechildren ids when resolver fails", async () => {
    const payload = [
      postListing(),
      {
        data: {
          children: [more(["x", "y"], "t3_post1")]
        }
      }
    ];

    const snapshot = await buildSeedThreadSnapshotFromPayload({
      seedThreadInput: "/r/AskReddit/comments/post1/seed_post/",
      permalink: "/r/AskReddit/comments/post1/seed_post",
      payload,
      resolveMoreChildren: async () => {
        throw new Error("network down");
      }
    });

    expect(snapshot.commentsFlattened.length).toBe(0);
    expect(snapshot.unresolvedMoreChildrenIds.sort()).toEqual(["x", "y"]);
  });
});
