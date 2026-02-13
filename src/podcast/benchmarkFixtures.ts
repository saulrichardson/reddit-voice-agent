import type { PostWithComments } from "./types.js";

/**
 * Synthetic fixture data for writer benchmarking.
 * We keep this local so benchmarking does not depend on Reddit credentials.
 */
export const BENCHMARK_POST_FIXTURES: PostWithComments[] = [
  {
    post: {
      id: "fixture-1",
      subreddit: "AskReddit",
      title:
        "What harmless family myth did you believe for way too long?",
      body:
        "I believed our microwave had a mood and would refuse to work if we yelled near it. My parents called it the 'emotional toaster'.",
      author: "family_lore_93",
      permalink: "/r/AskReddit/comments/fixture_1",
      score: 4123,
      numComments: 601,
      over18: false,
      createdUtc: 1730000000
    },
    comments: [
      {
        id: "fixture-1-c1",
        author: "casserole_commander",
        body:
          "My grandma said the TV remote had 'union rules' and took Sundays off.",
        score: 889,
        createdUtc: 1730000010
      },
      {
        id: "fixture-1-c2",
        author: "socks_and_science",
        body:
          "Dad told us thunder was clouds bowling and lightning was when someone got a strike.",
        score: 712,
        createdUtc: 1730000020
      },
      {
        id: "fixture-1-c3",
        author: "laundry_pirate",
        body:
          "We thought the dryer only worked if you thanked it out loud. Still do it at age 30.",
        score: 645,
        createdUtc: 1730000030
      },
      {
        id: "fixture-1-c4",
        author: "quietly_confused",
        body:
          "My older brother convinced me pigeons were interns trying to become seagulls.",
        score: 590,
        createdUtc: 1730000040
      }
    ]
  },
  {
    post: {
      id: "fixture-2",
      subreddit: "tifu",
      title:
        "TIFU by bringing a motivational whiteboard to a first date",
      body:
        "I thought it would be funny to do a 'quarterly relationship roadmap'. She thought it was a hostage negotiation. Dinner was brief.",
      author: "slide_deck_romance",
      permalink: "/r/tifu/comments/fixture_2",
      score: 6880,
      numComments: 1242,
      over18: false,
      createdUtc: 1730100000
    },
    comments: [
      {
        id: "fixture-2-c1",
        author: "deck_builder_404",
        body:
          "Did you at least include KPIs like laughing frequency and snack compatibility?",
        score: 1201,
        createdUtc: 1730100010
      },
      {
        id: "fixture-2-c2",
        author: "calendar_chaos",
        body:
          "Nothing says romance like asking someone to align on Q3 feelings.",
        score: 941,
        createdUtc: 1730100020
      },
      {
        id: "fixture-2-c3",
        author: "excel_for_two",
        body:
          "The real mistake was no pie chart. People trust circles.",
        score: 812,
        createdUtc: 1730100030
      },
      {
        id: "fixture-2-c4",
        author: "meeting_adjourned",
        body:
          "I would have stayed if there was an action item called 'dessert'.",
        score: 603,
        createdUtc: 1730100040
      }
    ]
  },
  {
    post: {
      id: "fixture-3",
      subreddit: "funny",
      title:
        "My city replaced pothole signs with tiny red carpets and now people are taking photos",
      body:
        "The mayor said we should 'celebrate infrastructure texture'. Someone added velvet ropes around the biggest crater downtown.",
      author: "road_texture_fan",
      permalink: "/r/funny/comments/fixture_3",
      score: 9551,
      numComments: 1744,
      over18: false,
      createdUtc: 1730200000
    },
    comments: [
      {
        id: "fixture-3-c1",
        author: "street_couture",
        body:
          "Finally, a red carpet event where everyone arrives by suspension damage.",
        score: 1604,
        createdUtc: 1730200010
      },
      {
        id: "fixture-3-c2",
        author: "public_works_parody",
        body:
          "I tripped into one and a paparazzi guy yelled, 'Give us anguish!'.",
        score: 1392,
        createdUtc: 1730200020
      },
      {
        id: "fixture-3-c3",
        author: "tire_alignment_zen",
        body:
          "They should name each pothole after a celebrity and sell tickets.",
        score: 1180,
        createdUtc: 1730200030
      },
      {
        id: "fixture-3-c4",
        author: "municipal_meme",
        body:
          "When life gives you craters, do premiere season.",
        score: 1005,
        createdUtc: 1730200040
      }
    ]
  }
];
