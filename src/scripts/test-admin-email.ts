
import "dotenv/config";
import emailService from "../utils/email.utils";

async function main() {
  console.log("Testing Admin Email Notification...");

  // Override ADMIN_EMAIL for testing if needed, or rely on .env
  // If ADMIN_EMAIL is not set in .env, it will use senderEmail (BREVO_SENDER_EMAIL) which is also fine for testing.
  
  if (!process.env.BREVO_API_KEY) {
      console.error("Error: BREVO_API_KEY is not set in .env");
      process.exit(1);
  }

  const subject = "[TEST] Admin Notification Test";
  const message = "This is a test notification from the automated test script to verify admin email alerts are working.";

  try {
    const result = await emailService.sendAdminNotification(subject, message);
    console.log("Admin notification sent successfully!");
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error("Failed to send admin notification:", error.message);
    if (error.response) {
        console.error("Response:", error.response.data);
    }
  }
}

main();
