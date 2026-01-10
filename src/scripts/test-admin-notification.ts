import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { PrismaClient } from "@prisma/client";
import { processTripayCallback } from "../payments/tripay.service";
import { buildSignature } from "../payments/tripay.util";

const prisma = new PrismaClient();

async function main() {
  console.log("--- Starting Admin Notification Test ---");

  // 1. Create or find a test user
  const testEmail = "testuser@example.com";
  let user = await prisma.user.findUnique({ where: { email: testEmail } });
  if (!user) {
    console.log("Creating test user...");
    user = await prisma.user.create({
      data: {
        email: testEmail,
        name: "Test User",
        password: "password123", // Dummy
        role: "USER",
      },
    });
  }
  console.log(`User: ${user.id} (${user.email})`);

  // 2. Create a dummy order
  console.log("Creating dummy order...");
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      totalAmount: 150000,
      status: "PENDING",
      shippingAddress: "Test Address",
      paymentMethod: "BNIVA",
      paymentExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    },
  });
  console.log(`Order created: ${order.id}`);

  // 3. Prepare Tripay Callback Payload
  const merchantCode = process.env.TRIPAY_MERCHANT_CODE || "";
  const privateKey = process.env.TRIPAY_PRIVATE_KEY || "";

  if (!merchantCode || !privateKey) {
    console.error("Missing TRIPAY_MERCHANT_CODE or TRIPAY_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const amount = Number(order.totalAmount);
  const signature = buildSignature(privateKey, merchantCode, order.id, amount);

  const payload = {
    merchant_ref: order.id,
    reference: "REF-TEST-" + Date.now(),
    status: "PAID",
    method: "BNIVA",
    amount: amount,
    total_amount: amount,
    signature: signature,
  };

  console.log(
    "Simulating Tripay Callback with payload:",
    JSON.stringify(payload, null, 2)
  );

  // 4. Call processTripayCallback
  try {
    const result = await processTripayCallback(payload);
    console.log("Callback processed successfully:", result);
    console.log("Check your admin email and in-app notifications.");
  } catch (error) {
    console.error("Error processing callback:", error);
  } finally {
    // Cleanup
    await prisma.order.delete({ where: { id: order.id } });
    // Optional: delete user if created just for this test
    // await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main();
