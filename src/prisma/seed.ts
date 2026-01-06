import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log(`Start seeding ...`);

  // --- Hashing Passwords ---
  const adminPassword = await bcrypt.hash("Meesha12345", 10);
  const userPassword = await bcrypt.hash("Ikrom12345", 10);

  // --- Seeding Users ---
  const admin = await prisma.user.upsert({
    where: { email: "meesha.co123@gmail.com" },
    update: {},
    create: {
      email: "meesha.co123@gmail.com",
      name: "Meesha Admin",
      password: adminPassword,
      role: Role.ADMIN,
      phone: "081234567890",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "ikrom.nur22@gmail.com" },
    update: {},
    create: {
      email: "ikrom.nur22@gmail.com",
      name: "Ikrom Nur",
      password: userPassword,
      role: Role.USER,
      phone: "089876543210",
    },
  });

  console.log(`Created admin user: ${admin.email}`);
  console.log(`Created user: ${user.email}`);

  // --- Seeding Products (PO variants) ---
  const po2 = await prisma.product.upsert({
    where: { id: "a3f0a868-2e65-4c9d-9f75-4cae0b3c3a01" },
    update: {
      name: "Seed PO 2-Day Product",
      price: 125000,
      stock: 10,
      availability: "PO_2_DAY",
    } as any,
    create: {
      id: "a3f0a868-2e65-4c9d-9f75-4cae0b3c3a01",
      name: "Seed PO 2-Day Product",
      price: 125000,
      stock: 10,
      availability: "PO_2_DAY",
    } as any,
  });

  const po5 = await prisma.product.upsert({
    where: { id: "c5bfe2ab-ff35-44c0-9aa0-82e2efdf0c2c" },
    update: {
      name: "Seed PO 5-Day Product",
      price: 155000,
      stock: 10,
      availability: "PO_5_DAY",
    } as any,
    create: {
      id: "c5bfe2ab-ff35-44c0-9aa0-82e2efdf0c2c",
      name: "Seed PO 5-Day Product",
      price: 155000,
      stock: 10,
      availability: "PO_5_DAY",
    } as any,
  });

  console.log(`Upserted PO products: ${po2.name}, ${po5.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
