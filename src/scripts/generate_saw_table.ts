import { PrismaClient } from "@prisma/client";
import {
  sizeIndex,
  normalizePrice,
  normalizePopularity,
  normalizeSize,
} from "../product/recommendation/saw";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const TARGET_PRODUCTS = [
  "🕊️Simply Romantic Fresh Bouquet",
  "🌸K-Simple Sweet Mix Bouquet",
  "🌸Sweet Purple Blossom",
  "🌸 Pink Holographic Glow",
  "💜 Sweet Violet Harmony",
  "🌹Classic Red Rose Bouquet",
  "🌹 Luxury Black Gold Red Roses",
  "🌼Pastel Garden Fresh Mix",
  "💗Classic Pink Romance Bouquet",
  "🌹 Sweetest Harmony Mix",
  "🌹 Classic Romantic Rose Ring",
  "🤍Pure Lily & Rose Romance",
  "🎀 Korean Pinky Bow Delight",
  "✨ Holo-Pink Radiance",
  "🩵Ice Blue Serenity",
  "🖤Royal Black Edition",
  "🌸 K-Sweet Pastel Blossom",
  "💙 Sapphire Sky Symphony",
  "🌹 Korean Midnight Scarlet Romance",
  "🩵 Ocean Breeze Mix",
  "❤️ Eternal Heart Black Edition",
  "☁️Grand Baby Blue Symphony",
  "💖Pinky Glitter Bouquet",
  "✨Sparkling Pink Satin Bouquet",
  "🩵 Icy Blue Royal Satin",
  "👑 Royal Princess Pink",
  "🎀Red Satin Rose",
  "👑 The Majesty Red Queen",
  "🍫 Sweet Gery White Delight",
  "💖 Pinky Sweetheart Pocky & SilverQueen Bear",
  "🍫 The Ultimate Snack Tower",
  "🍫Pocky Queen Delight",
  "💮Sweet Lily Delight",
  "🎉Prosperity Red Graduate Edition",
  "🌿 Emerald Sage Prosperity - Buket Uang 300 Ribu",
  "🎓 Royal Navy Scholar - Buket Uang 500 Ribu & Boneka Wisuda",
  "💖 Sweet Pink Fortune - Buket Uang 1 Juta (20 Lembar)",
  "💸 The Royal Sultan Blue",
  "🩶Kahf Men’s Care Grey Bouquet",
  "🎩Kahf & Rose Gentleman’s Black Edition",
  "👰‍♀️Cascading Bridal Elegance",
  "🕊️ Pure White Harmony - Hand Tied Bouquet (Gerbera & Rose Mix)",
  "🌿 Pure Lily & Peach Rose - Hand Tied Fresh Bouquet",
  "🎁Pastel Dream Bloom Box",
  "💙🌻 Vibrant Blue Sunshine",
  "🌷 Soft Velvet Tulip",
  "🍏 Fresh Orchard Breeze",
  "🎂 Sweet Blossom Cake Box",
  "☕ Rustic Mate Bloom (Tanpa Kopi)",
  "🎓 Blue Orchid Flower Board",
];

async function main() {
  // 1. Fetch all products
  const allProducts = await prisma.product.findMany();

  // 2. Filter/Find target products
  const data = allProducts
    .filter((p) => {
      const pName = p.name.toLowerCase().trim();
      return TARGET_PRODUCTS.some((t) => {
        const tName = t.toLowerCase().trim();
        return pName.includes(tName) || tName.includes(pName);
      });
    })
    .map((p) => ({
      name: p.name,
      price: p.price,
      sold: p.sold,
      sizeVal: sizeIndex(p.size),
      originalSize: p.size,
    }));

  if (data.length === 0) {
    console.log(
      "Tidak ada produk yang ditemukan. Pastikan database sudah terisi."
    );
    return;
  }

  // 3. Prepare Min/Max for Normalization
  const minPrice = Math.min(...data.map((d) => d.price));
  const maxSold = Math.max(...data.map((d) => d.sold));
  // Max Size fixed = 4 (Sangat Besar)

  // 4. Weights
  const W = {
    price: 5 / 12, // ~0.4167
    popularity: 4 / 12, // ~0.3333
    size: 3 / 12, // ~0.2500
  };

  let output = "";
  const log = (str: string) => {
    output += str + "\n";
    console.log(str);
  };

  // --- TABLE 1: INITIAL DATA ---
  log("\n### Tabel 1: Data Awal Produk");
  log(
    "| No | Nama Produk | Harga (Rp) | Terjual (Pop) | Ukuran | Nilai Ukuran |"
  );
  log("|---:|---|---:|---:|---|---:|");
  data.forEach((d, i) => {
    log(
      `| ${i + 1} | ${d.name} | ${d.price.toLocaleString("id-ID")} | ${
        d.sold
      } | ${d.originalSize || "-"} | ${d.sizeVal} |`
    );
  });

  // --- TABLE 2: WEIGHTING ---
  log("\n### Tabel 2: Pembobotan & Normalisasi Bobot");
  log("| Kriteria | Tipe | Bobot Awal | Bobot Normalisasi (W) |");
  log("|---|---|---:|---:|");
  log(`| Harga | Cost | 5 | ${W.price.toFixed(4)} |`);
  log(`| Popularitas | Benefit | 4 | ${W.popularity.toFixed(4)} |`);
  log(`| Ukuran | Benefit | 3 | ${W.size.toFixed(4)} |`);

  // --- TABLE 3: NORMALIZATION (R) ---
  log("\n### Tabel 3: Normalisasi Matriks (R)");
  log(`**Rumus:**`);
  log(
    `- R1 (Harga - Cost) = ${minPrice.toLocaleString("id-ID")} / Harga Produk`
  );
  log(`- R2 (Pop - Benefit) = Terjual / ${maxSold}`);
  log(`- R3 (Ukuran - Benefit) = Nilai Ukuran / 4`);
  log("");
  log("| No | Nama Produk | R1 (Harga) | R2 (Pop) | R3 (Ukuran) |");
  log("|---:|---|---:|---:|---:|");

  const normalized = data.map((d) => {
    const r1 = normalizePrice(minPrice, 0, d.price);
    const r2 = normalizePopularity(maxSold, d.sold);
    const r3 = normalizeSize(0, 0, d.sizeVal);
    return { ...d, r1, r2, r3 };
  });

  normalized.forEach((d, i) => {
    log(
      `| ${i + 1} | ${d.name} | ${d.r1.toFixed(4)} | ${d.r2.toFixed(
        4
      )} | ${d.r3.toFixed(4)} |`
    );
  });

  // --- TABLE 4: RANKING (V) ---
  log("\n### Tabel 4: Perangkingan & Skor Akhir (V)");
  log(
    `**Rumus Skor V = (R1 * ${W.price.toFixed(
      4
    )}) + (R2 * ${W.popularity.toFixed(4)}) + (R3 * ${W.size.toFixed(4)})**`
  );
  log("");
  log("| Rank | Nama Produk | Skor Akhir (V) |");
  log("|---:|---|---:|");

  const ranked = normalized.map((d) => {
    const score = d.r1 * W.price + d.r2 * W.popularity + d.r3 * W.size;
    return { ...d, score };
  });

  // Sort by Score Descending
  ranked.sort((a, b) => b.score - a.score);

  ranked.forEach((d, i) => {
    log(`| ${i + 1} | ${d.name} | ${d.score.toFixed(4)} |`);
  });

  fs.writeFileSync("saw_result.md", output, "utf-8");
  console.log("Output saved to saw_result.md");
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
