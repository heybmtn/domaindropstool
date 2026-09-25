/**
 * Hand-written DataForSEO response fixtures shaped per the v3 docs
 * (envelope → tasks[0] → result[]). Values are synthetic.
 */
export function envelope(result: unknown[], taskStatus = 20000, taskMessage = "Ok.", cost = 0.02) {
  return {
    version: "0.1.20260901",
    status_code: 20000,
    status_message: "Ok.",
    time: "0.1 sec.",
    cost,
    tasks_count: 1,
    tasks_error: taskStatus === 20000 ? 0 : 1,
    tasks: [{ id: "task-1", status_code: taskStatus, status_message: taskMessage, cost, result_count: result.length, result }],
  };
}

export const BACKLINK_SUMMARY_RESULT = [
  {
    target: "example.co.uk",
    first_seen: "2012-01-01 00:00:00 +00:00",
    rank: 312,
    backlinks: 15230,
    backlinks_spam_score: 12,
    referring_domains: 420,
    referring_main_domains: 390,
    referring_pages: 9800,
    referring_domains_nofollow: 40,
  },
];

export const DOMAIN_RANK_OVERVIEW_RESULT = [
  {
    target: "example.co.uk",
    location_code: 2826,
    language_code: "en",
    total_count: 1,
    items: [
      {
        se_type: "google",
        location_code: 2826,
        language_code: "en",
        metrics: {
          organic: { pos_1: 12, pos_2_3: 30, count: 1450, etv: 5320.5, estimated_paid_traffic_cost: 8100.25 },
          paid: { count: 0, etv: 0 },
        },
      },
    ],
  },
];

export const RANKED_KEYWORDS_RESULT = [
  {
    target: "example.co.uk",
    total_count: 1450,
    items: [
      {
        keyword_data: { keyword: "example widgets", keyword_info: { search_volume: 2400 } },
        ranked_serp_element: { serp_item: { rank_absolute: 3, etv: 410.2, url: "https://example.co.uk/widgets" } },
      },
      {
        keyword_data: { keyword: "buy widgets uk", keyword_info: { search_volume: 880 } },
        ranked_serp_element: { serp_item: { rank_absolute: 7, etv: 55.1, url: "https://example.co.uk/" } },
      },
    ],
  },
];

export const BACKLINKS_RESULT = [
  {
    target: "example.co.uk",
    total_count: 2,
    items: [
      {
        domain_from: "news.example",
        url_from: "https://news.example/story",
        url_to: "https://example.co.uk/",
        anchor: "Example",
        dofollow: true,
        domain_from_rank: 540,
        first_seen: "2019-03-01 00:00:00 +00:00",
      },
      {
        domain_from: "forum.example",
        url_from: "https://forum.example/t/1",
        url_to: "https://example.co.uk/page",
        anchor: "",
        dofollow: false,
        domain_from_rank: 120,
        first_seen: "2021-06-01 00:00:00 +00:00",
      },
    ],
  },
];

export const HISTORICAL_RESULT = [
  {
    target: "example.co.uk",
    items: [
      { year: 2026, month: 2, metrics: { organic: { etv: 6000, count: 1500 } } },
      { year: 2026, month: 1, metrics: { organic: { etv: 7000, count: 1600 } } },
    ],
  },
];
