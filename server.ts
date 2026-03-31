import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
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
  isPaused: boolean;
  checkInterval: number; // in seconds
  error?: string;
}

let users: TelegramUser[] = [];
const USERS_FILE = path.join(process.cwd(), "users.json");

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf-8");
      users = JSON.parse(data);
      console.log(`Loaded ${users.length} users from users.json`);
    } else {
      console.log("No users.json found, starting with empty list.");
      users = [];
    }
  } catch (error) {
    console.error("Error loading users:", error);
    users = [];
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    console.log(`Saved ${users.length} users to users.json`);
  } catch (error) {
    console.error("Error saving users:", error);
  }
}

// Load users on startup
loadUsers();

let currentStatus: Status = {
  isOpen: false,
  lastChecked: "Never",
  message: "Initializing...",
  isBotConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
  isPaused: false,
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

    saveUsers();

    bot?.sendMessage(chatId, `👋 Hello ${firstName || 'there'}! Welcome to the DV Lottery Monitor.\n\nYou are now subscribed to status change alerts.\n\nCommands:\n/status - Check current status\n/notify_every_check - Toggle notifications for every check\n/stop - Unsubscribe from alerts`);
  });

  // Command: /stop
  bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.chatId === chatId);
    if (user) {
      user.isActive = false;
      saveUsers();
      bot?.sendMessage(chatId, "🔕 You have been unsubscribed. Send /start to subscribe again.");
    } else {
      bot?.sendMessage(chatId, "You are not currently subscribed.");
    }
  });

  // Command: /status
  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const statusMsg = `🔍 Current Status: ${currentStatus.message}\n🕒 Last Checked: ${currentStatus.lastChecked !== "Never" ? new Date(currentStatus.lastChecked).toLocaleString() : "Never"}\n⏸️ Monitor is currently: ${currentStatus.isPaused ? 'PAUSED' : 'RUNNING'}`;
    bot?.sendMessage(chatId, statusMsg);
  });

  // Command: /notify_every_check
  bot.onText(/\/notify_every_check/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.chatId === chatId);
    if (user) {
      user.notifyEveryCheck = !user.notifyEveryCheck;
      saveUsers();
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

  if (currentStatus.isPaused) {
    console.log("Monitor is paused. Skipping check.");
    // Still schedule next check to re-evaluate pause state
    checkTimeout = setTimeout(checkDVLottery, currentStatus.checkInterval * 1000);
    return;
  }

  console.log("Checking DV Lottery status via Stealth Browser...");
  let browser;
  try {
    // Launch with specific version-matched User-Agent
    const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
        `--user-agent=${userAgent}`,
        "--disable-infobars",
        "--disable-notifications",
        "--lang=en-US,en"
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a consistent viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'keep-alive',
    });

    // 1. Navigate and wait for "networkidle2" (allows most scripts to finish)
    console.log("Navigating to https://dvprogram.state.gov/ ...");
    
    // Add extra headers to the request specifically for the main navigation
    await page.goto("https://dvprogram.state.gov/", { 
      waitUntil: "domcontentloaded", // Load faster, then wait
      timeout: 90000
    });

    // Random delay after navigation
    await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 3000));

    console.log("Waiting for security check to resolve...");

    // 1. Loop to find and click the Cloudflare "Turnstile" checkbox
    console.log("Searching for Cloudflare Turnstile...");
    let attempts = 0;
    while (attempts < 15) {
      const frames = page.frames();
      const challengeFrame = frames.find(f => f.url().includes('turnstile') || f.url().includes('cloudflare') || f.url().includes('captcha'));

      if (challengeFrame) {
        const selectors = ['input[type="checkbox"]', '#challenge-stage', '.ctp-checkbox-label', '.mark', '#challenge-form'];
        
        for (const selector of selectors) {
          try {
            const isVisible = await challengeFrame.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              const style = window.getComputedStyle(el);
              return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }, selector);

            if (isVisible) {
              console.log(`Found visible challenge element (${selector}). Clicking...`);
              await challengeFrame.click(selector, { delay: Math.random() * 200 + 50 });
              console.log("Click dispatched to challenge frame.");
              // Give it a moment to react after click
              await new Promise(resolve => setTimeout(resolve, 5000));
              break;
            }
          } catch (e) {}
        }

        // NEW: Blind click in the center of the frame if selectors fail
        if (attempts > 3 && attempts % 2 === 0) {
           console.log("Attempting blind click in center of challenge frame...");
           const frameBox = await page.evaluate((url) => {
             const frame = Array.from(document.querySelectorAll('iframe')).find(f => f.src.includes(url));
             if (!frame) return null;
             const rect = frame.getBoundingClientRect();
             return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
           }, 'turnstile');

           if (frameBox) {
             await page.mouse.click(
               frameBox.x + frameBox.width / 2,
               frameBox.y + frameBox.height / 2
             );
             console.log("Blind click dispatched.");
           }
        }
      }

      // Check if we've already broken through
      const currentHtml = await page.content();
      if (currentHtml.toLowerCase().includes("begin entry") || currentHtml.toLowerCase().includes("check status")) {
        console.log("Access granted! Site content detected.");
        break;
      }

      // Fallback: Try Tab + Space if we seem stuck
      if (attempts > 5 && attempts % 3 === 0) {
        console.log("Attempting keyboard navigation fallback (Tab + Space)...");
        await page.keyboard.press('Tab');
        await new Promise(resolve => setTimeout(resolve, 500));
        await page.keyboard.press('Space');
      }

      await new Promise(resolve => setTimeout(resolve, 4000));
      attempts++;
    }

    // 2. Wait for final stabilization
    console.log("Stabilizing page...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    const html = await page.content();
    const $ = cheerio.load(html);
    
    // 3. Robust check for status
    const isStuckOnChallenge = html.includes("challenge-error-text") || html.includes("_cf_chl_opt") || html.includes("Enable JavaScript and cookies");
    const isLotteryOpen = html.toLowerCase().includes("begin entry");
    const isOfficialSite = html.toLowerCase().includes("official strings") || html.toLowerCase().includes("electronic diversity visa") || html.toLowerCase().includes("dvprogram.state.gov");

    if (isStuckOnChallenge && !isLotteryOpen) {
      throw new Error("Cloudflare challenge unresolved (JS/Cookie error visible).");
    }

    if (!isOfficialSite && !isLotteryOpen) {
       throw new Error("Page content does not match expected site (possibly blocked).");
    }

    const isOpen = isLotteryOpen;
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
            saveUsers();
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

  app.post("/api/toggle-pause", (req, res) => {
    currentStatus.isPaused = !currentStatus.isPaused;
    console.log(`Monitor ${currentStatus.isPaused ? 'PAUSED' : 'RESUMED'}.`);
    
    // If resumed, trigger a check immediately
    if (!currentStatus.isPaused) {
      checkDVLottery();
    }
    
    res.json({ success: true, isPaused: currentStatus.isPaused });
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
