import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Send, ExternalLink, Clock } from "lucide-react";

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
  checkInterval: number;
  error?: string;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [intervalInput, setIntervalInput] = useState<string>("");

  const fetchStatus = async () => {
    try {
      const statusRes = await fetch("/api/status");
      const statusData = await statusRes.json();
      setStatus(statusData);
      if (statusData.checkInterval) {
        setIntervalInput(statusData.checkInterval.toString());
      }

      const usersRes = await fetch("/api/users");
      const usersData = await usersRes.json();
      setUsers(usersData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  const togglePause = async () => {
    setPausing(true);
    try {
      const response = await fetch("/api/toggle-pause", { method: "POST" });
      const data = await response.json();
      if (status) {
        setStatus({ ...status, isPaused: data.isPaused });
      }
    } catch (error) {
      console.error("Failed to toggle pause:", error);
    } finally {
      setPausing(false);
    }
  };

  const checkNow = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/check-now", { method: "POST" });
      const data = await response.json();
      setStatus(data);
      // Also refresh users in case bot state changed
      const usersRes = await fetch("/api/users");
      const usersData = await usersRes.json();
      setUsers(usersData);
    } catch (error) {
      console.error("Failed to check now:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const [testStatus, setTestStatus] = useState<{ loading: boolean; error?: string; success?: boolean }>({ loading: false });

  const testBot = async () => {
    setTestStatus({ loading: true });
    try {
      const response = await fetch("/api/test-bot", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        setTestStatus({ loading: false, success: true });
        setTimeout(() => setTestStatus({ loading: false }), 3000);
      } else {
        setTestStatus({ loading: false, error: data.error || "Failed to send test message" });
      }
    } catch (error) {
      setTestStatus({ loading: false, error: "Network error" });
    }
  };

  const updateSettings = async (updates: any) => {
    if (!status) return;
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updates }),
      });
      if (response.ok) {
        const data = await response.json();
        setStatus({ ...status, ...data });
      }
    } catch (error) {
      console.error("Failed to update settings:", error);
    }
  };

  const handleIntervalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(intervalInput);
    if (!isNaN(val) && val >= 60) {
      updateSettings({ checkInterval: val });
    } else {
      alert("Please enter a value of at least 60 seconds.");
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="w-8 h-8 text-blue-500" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-blue-500/30">
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-900/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-20">
        <motion.header 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-xs font-mono uppercase tracking-widest text-blue-400/80">Multi-User Monitor</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            DV Lottery <span className="text-blue-500">Tracker</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-md leading-relaxed">
            Automated monitoring with Telegram integration for multiple users.
          </p>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="relative group"
            >
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-500" />
              
              <div className="relative bg-[#141414] border border-white/10 rounded-2xl p-8 overflow-hidden">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="text-sm font-mono text-gray-500 uppercase tracking-wider mb-1">Current Status</h2>
                    <div className="flex items-center gap-2">
                      {status?.isOpen ? (
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                      ) : status?.error ? (
                        <AlertTriangle className="w-6 h-6 text-yellow-500" />
                      ) : (
                        <XCircle className="w-6 h-6 text-red-500" />
                      )}
                      <span className={`text-2xl font-semibold ${status?.isOpen ? 'text-green-400' : 'text-white'}`}>
                        {status?.isOpen ? 'OPEN' : 'CLOSED'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={togglePause}
                      disabled={pausing}
                      className={`px-4 py-2 rounded-xl text-xs font-mono transition-all border ${
                        status?.isPaused 
                          ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' 
                          : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20'
                      }`}
                    >
                      {pausing ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : status?.isPaused ? (
                        'RESUME MONITOR'
                      ) : (
                        'PAUSE MONITOR'
                      )}
                    </button>
                    <button
                      onClick={checkNow}
                      disabled={refreshing || status?.isPaused}
                      className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-gray-300 leading-relaxed">
                      {status?.message}
                    </p>
                    {status?.error && (
                      <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <p className="text-red-400 text-sm font-mono break-words">
                          <span className="font-bold">Error:</span> {status.error}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-500 font-mono">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>Last checked: {status?.lastChecked !== "Never" ? new Date(status!.lastChecked).toLocaleTimeString() : "Never"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.section 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-[#141414] border border-white/10 rounded-2xl p-8"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Send className="w-4 h-4 text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold">Subscribed Users</h3>
                </div>
                <span className="px-3 py-1 bg-white/5 rounded-full text-xs font-mono text-gray-400">
                  {users.filter(u => u.isActive).length} Active
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs font-mono text-gray-500 uppercase tracking-wider border-b border-white/5">
                      <th className="pb-4 font-medium">User</th>
                      <th className="pb-4 font-medium">Chat ID</th>
                      <th className="pb-4 font-medium">Notify All</th>
                      <th className="pb-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-500 text-sm">
                          No users have subscribed yet. Send <code className="bg-white/5 px-1.5 py-0.5 rounded">/start</code> to the bot.
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => (
                        <tr key={user.chatId} className="text-sm">
                          <td className="py-4">
                            <div className="font-medium text-gray-200">{user.firstName || 'Unknown'}</div>
                            <div className="text-xs text-gray-500">@{user.username || 'no_username'}</div>
                          </td>
                          <td className="py-4 font-mono text-gray-400">{user.chatId}</td>
                          <td className="py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${user.notifyEveryCheck ? 'bg-blue-500/10 text-blue-400' : 'bg-gray-500/10 text-gray-500'}`}>
                              {user.notifyEveryCheck ? 'ON' : 'OFF'}
                            </span>
                          </td>
                          <td className="py-4">
                            <span className={`flex items-center gap-1.5 ${user.isActive ? 'text-green-400' : 'text-gray-500'}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-gray-500'}`} />
                              {user.isActive ? 'Active' : 'Stopped'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </motion.section>
          </div>

          <div className="space-y-8">
            <motion.section 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="p-6 bg-[#141414] border border-white/10 rounded-2xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <Send className="w-4 h-4 text-purple-400" />
                </div>
                <h3 className="font-semibold">Bot Settings</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono mb-4">
                    <div className={`w-2 h-2 rounded-full ${status?.isBotConfigured ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className={status?.isBotConfigured ? 'text-green-500' : 'text-red-500'}>
                      {status?.isBotConfigured ? 'Bot Active' : 'Missing Token'}
                    </span>
                  </div>

                  {status?.isBotConfigured && (
                    <button
                      onClick={testBot}
                      disabled={testStatus.loading || users.filter(u => u.isActive).length === 0}
                      className={`w-full py-2 px-4 rounded-lg text-xs font-mono transition-all flex items-center justify-center gap-2 ${
                        testStatus.success ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 
                        testStatus.error ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        'bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 disabled:opacity-30'
                      }`}
                    >
                      {testStatus.loading ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : testStatus.success ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Test Sent to All
                        </>
                      ) : testStatus.error ? (
                        <>
                          <AlertTriangle className="w-3 h-3" />
                          Error: {testStatus.error}
                        </>
                      ) : (
                        <>
                          <Send className="w-3 h-3" />
                          Test Broadcast
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="pt-6 border-t border-white/5">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-400">Check Interval</span>
                  </div>
                  <form onSubmit={handleIntervalSubmit} className="flex gap-2">
                    <input
                      type="number"
                      min="60"
                      value={intervalInput}
                      onChange={(e) => setIntervalInput(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500/50 transition-colors"
                      placeholder="Seconds"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold transition-colors"
                    >
                      Save
                    </button>
                  </form>
                </div>
              </div>
            </motion.section>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="p-6 bg-blue-500/5 border border-blue-500/10 rounded-2xl"
            >
              <h4 className="text-xs font-mono text-blue-400 uppercase tracking-wider mb-3">Bot Commands</h4>
              <ul className="space-y-3 text-sm text-gray-400">
                <li className="flex gap-2">
                  <code className="text-blue-400">/start</code>
                  <span>Subscribe to alerts</span>
                </li>
                <li className="flex gap-2">
                  <code className="text-blue-400">/stop</code>
                  <span>Unsubscribe</span>
                </li>
                <li className="flex gap-2">
                  <code className="text-blue-400">/status</code>
                  <span>Get current status</span>
                </li>
                <li className="flex gap-2">
                  <code className="text-blue-400">/notify_every_check</code>
                  <span>Toggle all checks</span>
                </li>
              </ul>
            </motion.div>
          </div>
        </div>

        <footer className="mt-20 text-center text-gray-600 text-xs font-mono uppercase tracking-widest">
          &copy; 2026 DV Lottery Monitor &bull; Multi-User Broadcast System
        </footer>
      </main>
    </div>
  );
}
