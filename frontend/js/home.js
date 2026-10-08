import { listPage, getGithubActivity, postUrl, formatDate } from "./api.js";
import { splitBody, imageStrip, updateStrip } from "./strip.js";

const MAX_CARDS = 3;
const MONTH_LABEL_SPAN = 3;
const WEEKDAY_LABELS = [
  [1, "Mon"],
  [3, "Wed"],
  [5, "Fri"],
];

const cards = document.getElementById("posts");
const recent = document.getElementById("recent");
const status = document.getElementById("status");

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function label(post) {
  return post.title || post.preview.slice(0, 50) || "untitled";
}

function renderRecent(post) {
  const item = element("p", undefined, "recent-item");
  const link = element("a", label(post));
  link.href = postUrl(post.slug);
  item.append(link, element("span", formatDate(post.created_at), "date"));
  return item;
}

function renderCard(post) {
  const card = element("article", undefined, "home-post");
  const url = postUrl(post.slug);
  const { content, sources } = splitBody(post.body);

  if (sources.length) {
    const images = element("div", undefined, "home-post-images");
    images.append(imageStrip(sources));
    card.append(images);
  }

  const text = element("div", undefined, "home-post-text");
  if (post.title) {
    const heading = element("h3");
    const link = element("a", post.title);
    link.href = url;
    heading.append(link);
    text.append(heading);
  }
  const date = element("a", formatDate(post.created_at), "date");
  date.href = url;
  text.append(date);
  const body = element("div", undefined, "post-body");
  body.append(content);
  text.append(body);
  card.append(text);
  return card;
}

function updateStrips() {
  for (const wrap of cards.querySelectorAll(".thumbs-wrap")) updateStrip(wrap);
}

async function loadGithub() {
  const { days } = await getGithubActivity();
  const card = document.getElementById("github");
  card.hidden = !days.length;
  if (!days.length) return;

  const offset = new Date(`${days[0].date}T00:00:00`).getDay();
  const columns = Math.ceil((days.length + offset) / 7);
  const months = [];
  const cells = days.map((day, index) => {
    const cell = element("span", undefined, `github-day level-${day.level}`);
    const date = new Date(`${day.date}T00:00:00`);
    const column = Math.floor((index + offset) / 7);
    cell.style.gridColumn = String(column + 2);
    cell.style.gridRow = String(((index + offset) % 7) + 2);
    const when = date.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
    cell.title = `${day.count} contribution${day.count === 1 ? "" : "s"} on ${when}`;
    const month = date.toLocaleDateString("en-GB", { month: "short" });
    if (months.at(-1)?.month !== month && months.at(-1)?.column !== column) months.push({ month, column });
    return cell;
  });
  if (months.length > 1 && months[1].column - months[0].column < MONTH_LABEL_SPAN) months.shift();

  const monthLabels = months.map(({ month, column }) => {
    const label = element("span", month, "github-label");
    label.style.gridRow = "1";
    label.style.gridColumn = `${column + 2} / span ${Math.min(MONTH_LABEL_SPAN, columns - column)}`;
    return label;
  });
  const weekdayLabels = WEEKDAY_LABELS.map(([row, text]) => {
    const label = element("span", text, "github-label github-weekday");
    label.style.gridRow = String(row + 2);
    label.style.gridColumn = "1";
    return label;
  });
  const grid = element("div", undefined, "github-grid");
  grid.append(...monthLabels, ...weekdayLabels, ...cells);

  const total = days.reduce((sum, day) => sum + day.count, 0);
  const weeks = Math.round(days.length / 7);
  const summary = element("div", `${total} contribution${total === 1 ? "" : "s"} in the last ${weeks} weeks`, "github-summary");

  const legend = element("div", undefined, "github-legend");
  legend.append("Less", ...[0, 1, 2, 3, 4].map((level) => element("span", undefined, `github-day level-${level}`)), "More");
  card.replaceChildren(summary, grid, legend);
}

async function load() {
  const { posts } = await listPage(1);
  if (!posts.length) status.textContent = "No posts yet.";
  recent.append(...posts.map(renderRecent));
  cards.append(...posts.slice(0, MAX_CARDS).map(renderCard));
  updateStrips();
  window.addEventListener("resize", updateStrips);
  for (const image of cards.querySelectorAll("img")) image.addEventListener("load", updateStrips);
}

loadGithub().catch(() => null);

load().catch((error) => {
  status.textContent = error.message;
});
