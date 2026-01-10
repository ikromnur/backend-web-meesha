import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("--- Checking UNPAID/PENDING Orders ---");

  const orders = await prisma.order.findMany({
    where: {
      status: "PENDING",
    },
    select: {
      id: true,
      status: true,
      paymentExpiresAt: true,
      createdAt: true,
      user: {
        select: { email: true },
      },
    },
  });

  console.log(`Found ${orders.length} orders with PENDING status.`);

  const now = new Date();
  orders.forEach((o) => {
    const expires = o.paymentExpiresAt ? new Date(o.paymentExpiresAt) : null;
    const isExpired = expires ? expires < now : false;
    console.log(
      `Order ${o.id}: User=${o.user?.email}, Status=${
        o.status
      }, Created=${o.createdAt.toISOString()}, Expires=${
        expires?.toISOString() || "N/A"
      }, IsExpired=${isExpired}`
    );
  });

  await prisma.$disconnect();
}

main();
