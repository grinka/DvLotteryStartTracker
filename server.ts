import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

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

    bot?.sendMessage(chatId, "👋 Welcome to the DV Lottery Monitor!\n\nCommands:\n/status - Check status\n/stop - Unsubscribe");
  });

  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    bot?.sendMessage(chatId, `Current Status: ${currentStatus.message}`);
  });
}

async function checkDVLottery() {
  if (checkTimeout) clearTimeout(checkTimeout);

  if (currentStatus.isPaused) {
    checkTimeout = setTimeout(checkDVLottery, currentStatus.checkInterval * 1000);
    return;
  }

  console.log("Checking Reddit API...");
  try {
    const subreddits = ["dvlottery", "immigration"];
    let lotteryOpen = false;
    let detectionSource = "";

    for (const sub of subreddits) {
      const url = `https://www.reddit.com/r/${sub}/new.json?limit=10`;
      const response = await axios.get(url, {
        headers: {
          // A more realistic User-Agent for modern Chrome
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      const posts = response.data.data.children;
      for (const post of posts) {
        const title = post.data.title.toLowerCase();
        if (title.includes("2026") && (title.includes("open") || title.includes("started") || title.includes("live"))) {
          lotteryOpen = true;
          detectionSource = `r/${sub}`;
          break;
        }
      }
      if (lotteryOpen) break;
    }

    currentStatus.isOpen = lotteryOpen;
    currentStatus.lastChecked = new Date().toISOString();
    currentStatus.message = lotteryOpen ? "Likely OPEN!" : "Currently closed (Reddit check)";
    
    if (lotteryOpen && bot) {
      users.forEach(u => {
        if (u.isActive) bot.sendMessage(u.chatId, "🚨 DV Lottery likely OPEN!");
      });
    }
  } catch (error: any) {
    console.error("Reddit error:", error.message);
  } finally {
    checkTimeout = setTimeout(checkDVLottery, currentStatus.checkInterval * 1000);
  }
}

checkDVLottery();

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

