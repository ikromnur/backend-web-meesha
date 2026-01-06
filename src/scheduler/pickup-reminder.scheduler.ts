import cron from "node-cron";
import prisma from "../lib/prisma";
import emailUtils from "../utils/email.utils";
import { NotificationService } from "../notification/notification.service";

/**
 * Scheduler untuk mengirim reminder penjemputan (Pickup)
 * 1. H-1 (Sehari sebelum jadwal pickup)
 * 2. H-1h (Satu jam sebelum jadwal pickup)
 */
export const initPickupReminderScheduler = () => {
  console.log("[Scheduler] Initializing Pickup Reminder Scheduler...");
  const notificationService = new NotificationService(prisma);

  // Jalankan setiap 5 menit
  cron.schedule("*/5 * * * *", async () => {
    console.log("[Scheduler] Running pickup reminder check...");
    const now = new Date();

    // --- H-1 Reminder (23-25 hours from now) ---
    // Logika: Cari order yang pickupAt-nya besok (sekitar 24 jam dari sekarang)
    const startH1 = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const endH1 = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    try {
      const ordersH1 = await prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING", "READY_FOR_PICKUP"] },
          pickupAt: {
            gte: startH1,
            lte: endH1,
          },
          reminderH1Sent: false,
          user: { email: { not: undefined } },
        },
        include: { user: true },
      });

      for (const order of ordersH1) {
        if (order.user?.email && order.pickupAt) {
          try {
            // Email
            await emailUtils.sendPickupReminderEmail(
              order.user.email,
              order.id,
              order.user.name,
              order.pickupAt,
              "H-1"
            );

            // In-App Notification
            await notificationService.create({
              userId: order.userId,
              title: "Pengingat Penjemputan (Besok)",
              message: `Jangan lupa! Pesanan #${order.id} Anda dijadwalkan untuk diambil besok.`,
              type: "INFO",
              link: `/orders/${order.id}/pickup`,
            });

            await prisma.order.update({
              where: { id: order.id },
              data: { reminderH1Sent: true },
            });
            console.log(`[Scheduler] Sent H-1 reminder for order ${order.id}`);
          } catch (err) {
            console.error(
              `[Scheduler] Failed H-1 reminder for ${order.id}:`,
              err
            );
          }
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error processing H-1 reminders:", error);
    }

    // --- H-1h Reminder (0-90 mins from now) ---
    // Logika: Cari order yang pickupAt-nya sebentar lagi (dalam 1.5 jam)
    // Range 0 - 90 menit untuk menangkap yang mungkin terlewat di run sebelumnya
    const startH1h = now;
    const endH1h = new Date(now.getTime() + 90 * 60 * 1000);

    try {
      const ordersH1h = await prisma.order.findMany({
        where: {
          status: { in: ["PENDING", "PROCESSING", "READY_FOR_PICKUP"] },
          pickupAt: {
            gte: startH1h,
            lte: endH1h,
          },
          reminderH1hSent: false,
          user: { email: { not: undefined } },
        },
        include: { user: true },
      });

      for (const order of ordersH1h) {
        if (order.user?.email && order.pickupAt) {
          try {
            // Email
            await emailUtils.sendPickupReminderEmail(
              order.user.email,
              order.id,
              order.user.name,
              order.pickupAt,
              "H-1h"
            );

            // In-App Notification
            await notificationService.create({
              userId: order.userId,
              title: "Pengingat Penjemputan (1 Jam Lagi)",
              message: `Segera datang! Pesanan #${order.id} Anda dijadwalkan untuk diambil dalam 1 jam.`,
              type: "WARNING",
              link: `/orders/${order.id}/pickup`,
            });

            // --- Notifikasi Admin: Pengingat Pickup H-1h ---
            try {
              const admins = await prisma.user.findMany({
                where: { role: "ADMIN" },
              });
              for (const admin of admins) {
                await notificationService.create({
                  userId: admin.id,
                  title: "Pesanan Harus Siap (1 Jam Lagi)",
                  message: `Order #${order.id} akan diambil user ${order.user.name} dalam 1 jam. Pastikan pesanan siap!`,
                  type: "WARNING",
                  link: `/dashboard/orders/${order.id}`,
                });
              }
            } catch (adminNotifyErr) {
              console.error(
                `[Scheduler] Failed admin notification for order ${order.id}:`,
                adminNotifyErr
              );
            }

            await prisma.order.update({
              where: { id: order.id },
              data: { reminderH1hSent: true },
            });
            console.log(`[Scheduler] Sent H-1h reminder for order ${order.id}`);
          } catch (err) {
            console.error(
              `[Scheduler] Failed H-1h reminder for ${order.id}:`,
              err
            );
          }
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error processing H-1h reminders:", error);
    }
  });
};
