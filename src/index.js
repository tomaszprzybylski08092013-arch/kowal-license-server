import "dotenv/config";
import express from "express";
import { createDatabase } from "./database.js";
import { createLicenseService } from "./license-service.js";
import { sendDiscordWebhook } from "./discord-webhook.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const adminApiKey = process.env.ADMIN_API_KEY || "";
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
const databaseUrl = process.env.DATABASE_URL || "";

app.use(express.json());

function requireAdmin(req, res, next) {
  if (!adminApiKey || req.header("x-admin-key") !== adminApiKey) {
    res.status(401).json({ success: false, message: "Unauthorized." });
    return;
  }

  next();
}

app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

async function main() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const db = await createDatabase(databaseUrl);
  const licenseService = createLicenseService(db);

  app.post("/license/create", requireAdmin, async (req, res) => {
  const { minecraftNick, durationType, durationValue, note } = req.body ?? {};
  if (!minecraftNick || typeof minecraftNick !== "string" || !minecraftNick.trim()) {
    res.status(400).json({ success: false, message: "minecraftNick is required." });
    return;
  }

  if (!["days", "lifetime"].includes(durationType)) {
    res.status(400).json({ success: false, message: "Invalid duration type." });
    return;
  }

  if (durationType === "days" && (!Number.isInteger(durationValue) || durationValue <= 0)) {
    res.status(400).json({ success: false, message: "durationValue must be a positive integer." });
    return;
  }

  const license = await licenseService.createLicense({
    minecraftNick: minecraftNick.trim(),
    durationType,
    durationValue,
    note
  });
  res.json({ success: true, license });
  });

  app.post("/license/activate", async (req, res) => {
  const { licenseKey, installId, modVersion } = req.body ?? {};
  if (!licenseKey || !installId) {
    res.status(400).json({ success: false, status: "invalid", message: "licenseKey and installId are required." });
    return;
  }

  const result = await licenseService.activateLicense({ licenseKey, installId, modVersion });
  if (result.event) {
    await sendDiscordWebhook(discordWebhookUrl, result.event);
  }

  res.json(result);
  });

  app.post("/license/validate", async (req, res) => {
  const { sessionToken, installId, modVersion } = req.body ?? {};
  if (!sessionToken || !installId) {
    res.status(400).json({ success: false, status: "invalid", message: "sessionToken and installId are required." });
    return;
  }

  const result = await licenseService.validateLicense({ sessionToken, installId, modVersion });
  if (result.event) {
    await sendDiscordWebhook(discordWebhookUrl, result.event);
  }

  res.json(result);
  });

  app.get("/license/:licenseKey", requireAdmin, async (req, res) => {
  const license = await licenseService.getLicenseInfo(req.params.licenseKey);
  if (!license) {
    res.status(404).json({ success: false, message: "License not found." });
    return;
  }

  res.json({ success: true, license });
  });

  app.get("/license-by-nick/:minecraftNick", requireAdmin, async (req, res) => {
    const license = await licenseService.getLicenseInfoByNickname(req.params.minecraftNick);
    if (!license) {
      res.status(404).json({ success: false, message: "License not found." });
      return;
    }

    res.json({ success: true, license });
  });

  app.get("/licenses", requireAdmin, async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const result = await licenseService.listLicenses({ status, page, pageSize: 5 });
    res.json({ success: true, ...result });
  });

  app.post("/license/revoke", requireAdmin, async (req, res) => {
  const { licenseKey } = req.body ?? {};
  if (!licenseKey) {
    res.status(400).json({ success: false, message: "licenseKey is required." });
    return;
  }

  const revoked = await licenseService.revoke(licenseKey);
  res.json({ success: revoked });
  });

  app.listen(port, () => {
    console.log(`Kowal license server listening on port ${port}`);
  });
}

main().catch(error => {
  console.error("Failed to start Kowal license server:", error);
  process.exit(1);
});
