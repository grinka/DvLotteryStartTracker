import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cron from "node-cron";
import * as cheerio from "cheerio";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

dotenv.config();

const app = express();
const PORT = 3000;

interface TelegramUser {
  chatId: number;
  username?: string;
  firstName?: string;
  notifyEveryCheck: boolean;
  isActive: boolean;
}

interface Status {
  isOpen: boolean;
  lastChecked: string;
  message: string;
  isBotConfigured: boolean;
  checkInterval: number; // in seconds
  error?: string;
}

let users: TelegramUser[] = [];

let currentStatus: Status = {
  isOpen: false,
  lastChecked: "Never",
  message: "Initializing...",
  isBotConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
  checkInterval: 3600, // Default to 1 hour
};

let checkTimeout: NodeJS.Timeout | null = null;
let bot: TelegramBot | null = null;

// Initialize Bot with Polling
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log("Telegram Bot initialized with polling.");

  // Command: /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    const firstName = msg.from?.first_name;

    let user = users.find(u => u.chatId === chatId);
    if (!user) {
      user = {
        chatId,
        username,
        firstName,
        notifyEveryCheck: false,
        isActive: true
      };
      users.push(user);
    } else {
      user.isActive = true;
      user.username = username;
      user.firstName = firstName;
    }

    bot?.sendMessage(chatId, `👋 Hello ${firstName || 'there'}! Welcome to the DV Lottery Monitor.\n\nYou are now subscribed to status change alerts.\n\nCommands:\n/status - Check current status\n/notify_every_check - Toggle notifications for every check\n/stop - Unsubscribe from alerts`);
  });

  // Command: /stop
  bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.chatId === chatId);
    if (user) {
      user.isActive = false;
      bot?.sendMessage(chatId, "🔕 You have been unsubscribed. Send /start to subscribe again.");
    } else {
      bot?.sendMessage(chatId, "You are not currently subscribed.");
    }
  });

  // Command: /status
  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const statusMsg = `🔍 Current Status: ${currentStatus.message}\n🕒 Last Checked: ${currentStatus.lastChecked !== "Never" ? new Date(currentStatus.lastChecked).toLocaleString() : "Never"}`;
    bot?.sendMessage(chatId, statusMsg);
  });

  // Command: /notify_every_check
  bot.onText(/\/notify_every_check/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.chatId === chatId);
    if (user) {
      user.notifyEveryCheck = !user.notifyEveryCheck;
      bot?.sendMessage(chatId, `🔔 Notifications for every check are now: ${user.notifyEveryCheck ? 'ON' : 'OFF'}`);
    } else {
      bot?.sendMessage(chatId, "Please send /start first to subscribe.");
    }
  });
}

async function checkDVLottery() {
  if (checkTimeout) {
    clearTimeout(checkTimeout);
    checkTimeout = null;
  }

  console.log("Checking DV Lottery status via Stealth Browser...");
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    
    // Navigate to the site
    console.log("Navigating to https://dvprogram.state.gov/ ...");
    await page.goto("https://dvprogram.state.gov/", { 
      waitUntil: "networkidle2",
      timeout: 60000 
    });

    // Wait a bit for any JS challenges to resolve
    await new Promise(resolve => setTimeout(resolve, 5000));

    const html = await page.content();
    const $ = cheerio.load(html);
    
    // Look for "Begin Entry" button
    const beginEntryButton = $('a:contains("Begin Entry")');
    const isOpen = beginEntryButton.length > 0 || html.includes("Begin Entry");
    
    if (!isOpen) {
      console.log("Begin Entry button not found. Checking for other indicators...");
      // Check if we are still stuck on Cloudflare
      if (html.includes("Checking your browser") || html.includes("challenge-running") || html.includes("Verifying you are not a bot")) {
        throw new Error("Stuck on Cloudflare challenge. The site is detecting bot behavior.");
      }
      
      // Log a snippet of the text content to help debug
      const bodyText = $("body").text().substring(0, 500).replace(/\s+/g, ' ');
      console.log("Page Text Snippet:", bodyText);
    }
    
    const statusMessage = isOpen 
      ? "DV Lottery Entry Period is OPEN!" 
      : "DV Lottery Entry Period is currently closed.";

    const previousStatus = currentStatus.isOpen;
    currentStatus = {
      ...currentStatus,
      isOpen,
      lastChecked: new Date().toISOString(),
      message: statusMessage,
      error: undefined,
    };

    console.log(`Status: ${statusMessage}`);

    // Notify all active users
    if (bot) {
      for (const user of users) {
        if (!user.isActive) continue;

        try {
          if (isOpen && !previousStatus) {
            console.log(`Sending status change alert to Telegram user ${user.chatId}...`);
            await bot.sendMessage(user.chatId, `🚨 ALERT: ${statusMessage}\nGo to: https://dvprogram.state.gov/`);
          } else if (user.notifyEveryCheck) {
            console.log(`Sending test check notification to Telegram user ${user.chatId}...`);
            await bot.sendMessage(user.chatId, `🔍 TEST CHECK: ${statusMessage}\nLast Checked: ${currentStatus.lastChecked}`);
          }
        } catch (tgError: any) {
          console.error(`Telegram Error for user ${user.chatId}:`, tgError.message);
          if (tgError.message.includes("bot was blocked by the user")) {
            user.isActive = false;
          }
        }
      }
    }
  } catch (error: any) {
    console.error("Error checking DV Lottery:", error.message);
    currentStatus = {
      ...currentStatus,
      lastChecked: new Date().toISOString(),
      message: "Error checking status",
      error: error.message,
    };
    
    if (bot) {
      for (const user of users) {
        if (user.isActive && user.notifyEveryCheck) {
          bot.sendMessage(user.chatId, `❌ Error checking DV Lottery: ${error.message}\nLast Checked: ${currentStatus.lastChecked}`).catch(console.error);
        }
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    // Schedule next check
    console.log(`Next check scheduled in ${currentStatus.checkInterval} seconds.`);
    checkTimeout = setTimeout(checkDVLottery, currentStatus.checkInterval * 1000);
  }
}

// Initial check on startup
checkDVLottery();

async function startServer() {
  // API routes
  app.get("/api/status", (req, res) => {
    const isConfigured = !!process.env.TELEGRAM_BOT_TOKEN;
    res.json({
      ...currentStatus,
      isBotConfigured: isConfigured
    });
  });

  app.get("/api/users", (req, res) => {
    res.json(users);
  });

  app.post("/api/settings", express.json(), (req, res) => {
    const { checkInterval } = req.body;
    
    if (typeof checkInterval === "number" && checkInterval >= 60) {
      currentStatus.checkInterval = checkInterval;
      // Reschedule if interval changed
      if (checkTimeout) {
        clearTimeout(checkTimeout);
        console.log(`Interval updated to ${checkInterval}s. Rescheduling next check.`);
        checkTimeout = setTimeout(checkDVLottery, checkInterval * 1000);
      }
    }

    res.json({ 
      success: true, 
      checkInterval: currentStatus.checkInterval
    });
  });

  app.post("/api/test-bot", async (req, res) => {
    const currentToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!currentToken) {
      return res.status(400).json({ success: false, error: "Bot not configured" });
    }

    try {
      // Send test message to all active users
      if (users.length === 0) {
        return res.status(400).json({ success: false, error: "No active users to test with. Send /start to the bot first." });
      }

      for (const user of users) {
        if (user.isActive) {
          await bot?.sendMessage(user.chatId, "✅ Telegram Bot Connection Test: Success!");
        }
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Test Bot Error:", error.message);
      let errorMessage = error.message;
      if (error.response && error.response.body && error.response.body.description) {
        errorMessage = error.response.body.description;
      }
      res.status(500).json({ success: false, error: errorMessage });
    }
  });

  app.post("/api/check-now", async (req, res) => {
    await checkDVLottery();
    const isConfigured = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
    res.json({
      ...currentStatus,
      isBotConfigured: isConfigured
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
