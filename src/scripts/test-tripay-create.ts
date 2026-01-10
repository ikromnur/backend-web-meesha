import "dotenv/config";
import axios from "axios";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. Get a user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("No user found");
    return;
  }
  console.log(`Testing with user: ${user.email} (${user.id})`);

  // 2. Generate Token
  const secret = process.env.JWT_SECRET || "secret";
  const token = jwt.sign({ userId: user.id, role: user.role }, secret, {
    expiresIn: "1h",
  });

  // 3. Prepare Payload
  const payload = {
    amount: 10000,
    method: "BNIVA",
    customer_name: user.name || "Test User",
    customer_email: user.email,
    customer_phone: "081234567890",
    order_items: [
      {
        sku: "09367ebd-d22b-4fc0-aec1-e302a0fc7362",
        name: "Test Item",
        price: 10000,
        quantity: 1,
      },
    ],
    // expiry 24 hours from now (epoch)
    expired_time: Math.floor(Date.now() / 1000) + 24 * 3600,
    pickup_date: "2026-02-01",
    pickup_time: "10:00",
  };

  console.log("Sending payload:", JSON.stringify(payload, null, 2));

  // 4. Send Request
  try {
    const res = await axios.post(
      "http://localhost:4000/api/v1/payments/tripay/closed",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    console.log("Success:", res.status, res.data);
  } catch (err: any) {
    console.error("Error:", err.response?.status, err.response?.data);
    if (err.response?.data?.minPickupAt) {
      console.log("MinPickupAt suggestions:", err.response.data.minPickupAt);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
