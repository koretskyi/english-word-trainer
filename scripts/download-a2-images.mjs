import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src", "sentences.js");
const outputDir = path.join(root, "public", "images", "a2");
const manifestPath = path.join(outputDir, "manifest.json");

const searchTerms = {
  appointment: "doctor appointment patient consultation",
  wallet: "leather wallet purse",
  station: "train railway station building",
  slowly: "snail moving slowly",
  message: "person sending text message smartphone",
  cooked: "cooked dinner meal plate",
  ticket: "train ticket travel",
  colleagues: "coworkers colleagues working together office",
  form: "paper application form filling",
  windy: "wind blowing trees",
  card: "contactless bank card payment",
  traffic: "traffic jam cars road",
  charger: "mobile phone charger cable",
  river: "river flowing landscape",
  closes: "shop closing shutter",
  laundry: "washing clothes laundry basket",
  journey: "train journey countryside",
  affordable: "affordable apartment rental price",
  umbrella: "open umbrella rain",
  bus: "city bus public transport",
  borrow: "person borrowing a book from library",
  choose: "choosing between two options",
  decide: "person making a decision",
  invite: "invitation birthday party card",
  arrive: "passenger arriving at airport",
  leave: "person leaving home suitcase",
  return: "returning parcel package post office",
  repair: "person repairing household item tools",
  broken: "broken household object",
  expensive: "luxury expensive price tag",
  cheap: "low price discount price tag",
  crowded: "crowded bus passengers",
  quiet: "quiet peaceful library",
  noisy: "busy noisy city street",
  healthy: "healthy balanced food plate",
  careful: "person handling fragile glass carefully",
  dangerous: "danger warning sign",
  weather: "sunny cloudy rainy weather",
  weekend: "weekend calendar Saturday Sunday",
  holiday: "beach holiday vacation",
  neighbour: "neighbors talking outside houses",
  kettle: "electric kettle kitchen",
  mirror: "wall mirror reflection",
  shelf: "bookshelf books",
  medicine: "medicine bottle tablets",
  receipt: "printed shopping receipt",
  recipe: "cooking recipe ingredients cookbook",
  platform: "railway station train platform",
  improve: "progress improvement growing plant",
  describe: "person explaining describing object",
};

const source = await readFile(sourcePath, "utf8");
const blocks = source.split(/(?=\{\s*id:\s*")/);
const words = blocks.map((body) => {
  const word = body.match(/\bword:\s*"([^"]+)"/)?.[1];
  const level = body.match(/\blevel:\s*"([^"]+)"/)?.[1];
  return level === "A2" && word ? word.trim().toLowerCase() : null;
}).filter(Boolean);

if (!words.length) throw new Error("Не удалось найти слова уровня A2 в src/sentences.js");
await mkdir(outputDir, { recursive: true });

let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch {}

function extensionFrom(item, response) {
  const type = response.headers.get("content-type") || "";
  if (/image\/jpeg/i.test(type)) return "jpg";
  if (/image\/png/i.test(type)) return "png";
  if (/image\/webp/i.test(type)) return "webp";
  if (/image\/gif/i.test(type)) return "gif";
  const filetype = String(item.filetype || "").toLowerCase();
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(filetype) ? filetype.replace("jpeg", "jpg") : "jpg";
}

async function fetchImage(item) {
  const candidates = [item.url, item.thumbnail].filter(Boolean);
  let lastError;
  for (const url of [...new Set(candidates)]) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "EnglishWordTrainer/1.0 (local vocabulary image library)" } });
      if (!response.ok) throw new Error(`image HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) throw new Error("ответ не является изображением");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1500) throw new Error("изображение слишком маленькое или пустое");
      if (bytes.length > 8 * 1024 * 1024 && url === item.url && item.thumbnail) continue;
      return { bytes, extension: extensionFrom(item, response) };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("не удалось скачать изображение");
}

async function downloadWord(word) {
  const query = searchTerms[word] || word;
  const params = new URLSearchParams({
    q: query,
    page_size: "20",
    mature: "false",
    filter_dead: "true",
  });
  const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { "User-Agent": "EnglishWordTrainer/1.0 (educational vocabulary project)", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Openverse API HTTP ${response.status}`);
  const data = await response.json();
  const results = (data.results || []).filter((item) => item.url || item.thumbnail);
  if (!results.length) throw new Error("Openverse не нашёл изображение");

  // Openverse already ranks by relevance; prefer a usable landscape/square image.
  results.sort((a, b) => {
    const score = (item) => {
      let value = 0;
      if (item.width && item.height && Math.min(item.width, item.height) >= 300) value += 3;
      if (item.mature) value -= 100;
      if (item.filetype && !["svg"].includes(item.filetype)) value += 1;
      return value;
    };
    return score(b) - score(a);
  });

  let selected;
  let image;
  let lastError;
  for (const item of results.slice(0, 8)) {
    try {
      image = await fetchImage(item);
      selected = item;
      break;
    } catch (error) { lastError = error; }
  }
  if (!selected || !image) throw lastError || new Error("не удалось скачать ни один результат");

  // Normalize every downloaded image to a small, consistently sized WebP.
  // Try progressively lower quality until the image is near the 120 KB target.
  let optimized;
  let qualityUsed = 78;
  for (const quality of [78, 70, 62, 55, 48]) {
    const candidate = await sharp(image.bytes, { animated: false })
      .rotate()
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    optimized = candidate;
    qualityUsed = quality;
    if (candidate.length <= 120 * 1024) break;
  }

  const filename = `${word}.webp`;
  await writeFile(path.join(outputDir, filename), optimized);
  const metadata = await sharp(optimized).metadata();
  return {
    src: `/images/a2/${filename}`,
    optimizedVersion: 1,
    format: "webp",
    width: metadata.width || 0,
    height: metadata.height || 0,
    sizeBytes: optimized.length,
    quality: qualityUsed,
    provider: "Openverse",
    title: selected.title || word,
    source: selected.foreign_landing_url || selected.detail_url || "https://openverse.org/",
    creator: selected.creator || "Unknown",
    license: selected.license || "License not specified",
    licenseUrl: selected.license_url || "",
    attribution: selected.attribution || "",
  };
}

console.log(`Найдено слов A2: ${words.length}. Скачиваю изображения из Openverse в public/images/a2 ...`);
let downloaded = 0, skipped = 0, failed = 0;

for (const word of words) {
  const existing = manifest[word];
  if (existing?.provider === "Openverse" && existing?.optimizedVersion === 1 && existing?.src) {
    try {
      await access(path.join(outputDir, path.basename(existing.src)));
      console.log(`✓ ${word}: уже есть`);
      skipped++;
      continue;
    } catch {}
  }
  try {
    manifest[word] = await downloadWord(word);
    console.log(`↓ ${word}: ${manifest[word].title} — ${(manifest[word].sizeBytes / 1024).toFixed(1)} KB, ${manifest[word].width}×${manifest[word].height} WebP`);
    downloaded++;
  } catch (error) {
    console.warn(`! ${word}: ${error.message}`);
    failed++;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("\nГотово.");
console.log(`Скачано: ${downloaded}; уже было: ${skipped}; ошибки: ${failed}; всего слов: ${words.length}.`);
console.log("Изображения сохранены в WebP (максимум 640×640); автор, источник и лицензия — в manifest.json.");
if (failed) console.log("Повторный запуск попробует скачать отсутствующие изображения ещё раз.");
