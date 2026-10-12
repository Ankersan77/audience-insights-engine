import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCompactReport } from "./parseCompactReport.ts";

// Real example text from a saved last30days compact report (this project's
// own earlier research run) — not a fabricated fixture.

test("TikTok item's venue field becomes author_handle (creator platform)", () => {
  const stdout = `
1. [tiktok] bron got me right tho👀 #sportsbetting #kalshi #CollegeFootball #sportstok #prizepicks
   - 2026-10-08 | lockinwith.ju | [288views, 11likes, 1cmt] | score:41
   - URL: [https://www.tiktok.com/@lockinwith.ju/video/7694131752217988382](https://www.tiktok.com/@lockinwith.ju/video/7694131752217988382)
   - Evidence: bron got me right tho👀 #sportsbetting #kalshi #CollegeFootball #sportstok #prizepicks
`;
  const items = parseCompactReport(stdout);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "tiktok");
  assert.equal(items[0].authorHandle, "lockinwith.ju");
});

test("Reddit item's venue field (a subreddit) does NOT become author_handle", () => {
  const stdout = `
1. [reddit] Do sports prediction markets eventually replace traditional books for serious users?
   - 2026-09-22 | r/PredictionMarkets | [7pts, 16cmt] | score:34
   - URL: [https://www.reddit.com/r/PredictionMarkets/comments/1wnof1u/do_sports_prediction_markets_eventually_replace/](https://www.reddit.com/r/PredictionMarkets/comments/1wnof1u/do_sports_prediction_markets_eventually_replace/)
   - Evidence: Do sports prediction markets eventually replace traditional books for serious users?
`;
  const items = parseCompactReport(stdout);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "reddit");
  assert.equal(items[0].authorHandle, null, "a subreddit name is a community, not a person");
  assert.equal(items[0].externalId, "1wnof1u", "still extracts the Reddit post id correctly");
});

test("Reddit top-comment authors (u/handle lines) are still not captured as author_handle — known, separate gap (docs/dsr-procedure.md)", () => {
  const stdout = `
1. [reddit] NCAAF college football betting and picks 10/7/26
   - 2026-10-07 | r/sportsbook | [19pts, 34cmt] | score:42
   - URL: [https://www.reddit.com/r/sportsbook/comments/1wzmxx3/ncaaf_college_football_betting_and_picks_10726/](https://www.reddit.com/r/sportsbook/comments/1wzmxx3/ncaaf_college_football_betting_and_picks_10726/)
   - Evidence: Season record is 25-14.
   - u/RustyCrusty73 (21 upvotes): Season record is 25-14.
`;
  const items = parseCompactReport(stdout);
  assert.equal(items.length, 1);
  assert.equal(
    items[0].authorHandle,
    null,
    "comment authors are a known gap this fix does not close — see docs/dsr-procedure.md"
  );
});
