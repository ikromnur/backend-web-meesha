import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    // Provider dari schema adalah postgresql; jalankan backfill kompatibel Postgres
    // 1) pickupStart = pickupAt (jika ada)
    // 2) pickupEnd = pickupStart + 1 jam (default slot)
    // Gunakan $executeRawUnsafe untuk fleksibilitas
    const setStart = await prisma.$executeRawUnsafe(`UPDATE "Order" SET "pickupStart" = "pickupAt" WHERE "pickupAt" IS NOT NULL;`);
    const setEnd = await prisma.$executeRawUnsafe(`UPDATE "Order" SET "pickupEnd" = "pickupStart" + INTERVAL '1 hour' WHERE "pickupStart" IS NOT NULL;`);
    console.log(`Backfill done. Updated start: ${setStart}, end: ${setEnd}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

