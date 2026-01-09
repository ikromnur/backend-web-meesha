import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: { user: true, orderItems: true },
  });

  console.log("Last 5 orders:");
  orders.forEach((o) => {
    console.log(`ID: ${o.id}`);
    console.log(`User: ${o.user?.email} (${o.userId})`);
    console.log(`Status: ${o.status}`);
    console.log(`Created: ${o.createdAt.toISOString()}`);
    console.log(`Expires: ${o.paymentExpiresAt?.toISOString()}`);
    console.log(`Total: ${o.totalAmount}`);
    console.log("Items:", o.orderItems.length);
    console.log("-----------------------------------");
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
