import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src", "sentences.js");
const outputDir = path.join(root, "public", "images", "a2");
const manifestPath = path.join(outputDir, "manifest.json");

const searchTerms = {
  appointment: "calendar appointment doctor",
  wallet: "wallet",
  station: "railway station",
  slowly: "snail moving slowly",
  message: "text message smartphone",
  cooked: "cooked meal food",
  ticket: "train ticket",
  colleagues: "colleagues coworkers office",
  form: "paper form document",
  windy: "wind blowing trees",
  card: "bank card",
  traffic: "traffic jam cars",
  charger: "mobile phone charger",
  river: "river landscape",
  closes: "shop closing door",
  laundry: "laundry washing clothes",
  journey: "train journey travel",
  affordable: "affordable price price tag",
  umbrella: "umbrella",
  bus: "city bus",
  borrow: "borrowing a book",
  choose: "choosing between options",
  decide: "making a decision",
  invite: "invitation card",
  arrive: "arriving at airport",
  leave: "leaving home suitcase",
  return: "return parcel package",
  repair: "repair tools",
  broken: "broken object",
  expensive: "expensive price tag",
  cheap: "cheap sale price tag",
  crowded: "crowded public place",
  quiet: "quiet library",
  noisy: "noisy street",
  healthy: "healthy food",
  careful: "caution careful handling",
  dangerous: "danger warning sign",
  weather: "weather cloudy sunny",
  weekend: "weekend calendar",
  holiday: "holiday vacation beach",
  neighbour: "neighbors talking",
  kettle: "electric kettle",
  mirror: "wall mirror",
  shelf: "bookshelf",
  medicine: "medicine bottle",
  receipt: "shopping receipt",
  recipe: "recipe cooking ingredients",
  platform: "railway platform",
  improve: "improvement progress",
  describe: "person describing something",
};

const source = await readFile(sourcePath, "utf8");
const blocks = [...source.matchAll(/\{\s*id:\s*"([^"]+)"([\s\S]*?)\n\s*\}/g)];
const words = blocks
  .map((match) => {
    const body = match[2];
    const word = body.match(/\bword:\s*"([^"]+)"/)?.[1];
    const level = body.match(/\blevel:\s*"([^"]+)"/)?.[1];
    return level === "A2" && word ? word.trim().toLowerCase() : null;
  })
  .filter(Boolean);

if (!words.length) throw new Error("Не удалось найти слова уровня A2 в src/sentences.js");

await mkdir(outputDir, { recursive: true });

let manifest = {};
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  manifest = {};
}

function extensionFromContentType(contentType, url) {
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/image\/webp/i.test(contentType)) return "webp";
  if (/image\/gif/i.test(contentType)) return "gif";
  if (/image\/svg\+xml/i.test(contentType)) return "svg";
  const match = url.match(/\.(jpe?g|png|webp|gif|svg)(?:[?#]|$)/i);
  return match ? match[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

async function downloadWord(word) {
  const query = searchTerms[word] || word;
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "15",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
    format: "json",
    origin: "*",
  });

  const searchResponse = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "EnglishWordTrainer/1.0 (local vocabulary image downloader)" },
  });
  if (!searchResponse.ok) throw new Error(`Wikimedia search HTTP ${searchResponse.status}`);
  const data = await searchResponse.json();
  const pages = Object.values(data.query?.pages || {})
    .filter((page) => page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url);

  if (!pages.length) throw new Error("изображение не найдено");

  const normalized = word.toLowerCase();
  pages.sort((a, b) => {
    const titleA = a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const titleB = b.title.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const exactA = titleA.includes(normalized) ? 1 : 0;
    const exactB = titleB.includes(normalized) ? 1 : 0;
    return exactB - exactA;
  });

  // For concept words, use the first result for the more descriptive search phrase.
  const selected = pages[0];
  const info = selected.imageinfo[0];
  const imageUrl = info.thumburl || info.url;
  const imageResponse = await fetch(imageUrl, {
    headers: { "User-Agent": "EnglishWordTrainer/1.0 (local vocabulary image downloader)" },
  });
  if (!imageResponse.ok) throw new Error(`image HTTP ${imageResponse.status}`);

  const contentType = imageResponse.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error("сервер вернул не изображение");
  const extension = extensionFromContentType(contentType, imageUrl);
  const filename = `${word.replace(/[^a-z0-9-]/g, "-")}.${extension}`;
  await writeFile(path.join(outputDir, filename), Buffer.from(await imageResponse.arrayBuffer()));

  return {
    src: `/images/a2/${filename}`,
    title: selected.title.replace(/^File:/, "").replaceAll("_", " "),
    source: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(selected.title.replaceAll(" ", "_"))}`,
    license: info.extmetadata?.LicenseShortName?.value || "Wikimedia Commons",
  };
}

console.log(`Найдено слов A2: ${words.length}. Сохраняю картинки в public/images/a2 ...`);

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const word of words) {
  const existing = manifest[word];
  if (existing?.src) {
    try {
      await access(path.join(outputDir, path.basename(existing.src)));
      console.log(`✓ ${word}: уже есть`);
      skipped++;
      continue;
    } catch {
      // Re-download missing local file.
    }
  }

  try {
    manifest[word] = await downloadWord(word);
    console.log(`↓ ${word}: ${manifest[word].title}`);
    downloaded++;
  } catch (error) {
    console.warn(`! ${word}: ${error.message}`);
    failed++;
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("\nГотово.");
console.log(`Скачано: ${downloaded}; уже было: ${skipped}; не найдено: ${failed}; всего слов: ${words.length}.`);
console.log("Сведения об источниках и лицензиях сохранены в public/images/a2/manifest.json.");
