import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const product = await prisma.product.findFirst();
  console.log("Product ID:", product?.id);
  console.log("Product Name:", product?.name);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
