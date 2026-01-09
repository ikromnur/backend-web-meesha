
import dotenv from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const prisma = new PrismaClient();

async function main() {
  const email = "ikrom.nurr22@gmail.com";
  console.log(`Checking user with email: ${email}`);

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (user) {
    console.log("User found:", user);
  } else {
    console.log("User NOT found.");
  }

  await prisma.$disconnect();
}

main();
