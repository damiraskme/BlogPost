const API_URL = "https://api.github.com/graphql";
const CACHE_MS = 60 * 60 * 1000;
const DAYS = 77;
const DAY_MS = 24 * 60 * 60 * 1000;

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const CALENDAR = `contributionsCollection(from: $from, to: $to) {
  contributionCalendar {
    weeks {
      contributionDays {
        date
        contributionCount
        contributionLevel
      }
    }
  }
}`;

const USER_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) { user(login: $login) { ${CALENDAR} } }`;
const VIEWER_QUERY = `query($from: DateTime!, $to: DateTime!) { viewer { ${CALENDAR} } }`;

let cache = { user: null, at: 0, days: [] };

function isConfigured() {
  return Boolean(process.env.GITHUB_TOKEN);
}

function readCalendar(data) {
  const owner = data?.user || data?.viewer;
  const weeks = owner?.contributionsCollection?.contributionCalendar?.weeks || [];
  return weeks
    .flatMap((week) => week.contributionDays)
    .map((day) => ({ date: day.date, level: LEVELS[day.contributionLevel] ?? 0, count: day.contributionCount }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAYS);
}

async function fetchActivity(user) {
  const to = new Date();
  const from = new Date(to.getTime() - (DAYS + 7) * DAY_MS);
  const variables = { from: from.toISOString(), to: to.toISOString() };
  if (user) variables.login = user;
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "portfolioblog",
    },
    body: JSON.stringify({ query: user ? USER_QUERY : VIEWER_QUERY, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`);
  if (body?.errors?.length) throw new Error(body.errors[0].message);
  return readCalendar(body?.data);
}

async function recentActivity(user) {
  if (!isConfigured()) return [];
  const key = user || "";
  if (cache.user === key && Date.now() - cache.at < CACHE_MS) return cache.days;
  try {
    cache = { user: key, at: Date.now(), days: await fetchActivity(user) };
  } catch (error) {
    console.error(`GitHub activity: ${error.message}`);
  }
  return cache.user === key ? cache.days : [];
}

module.exports = { isConfigured, recentActivity };
