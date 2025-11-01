/**
 * Telegram Bot Service
 * 
 * Provides Telegram bot integration for:
 * - Miner control (reboot, status)
 * - Statistics queries
 * - Alert notifications
 * - Interactive commands
 * 
 * @module services/telegram
 */

import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../utils/logger';
import { getMiningStats, getMinerStats, restartMiner } from './mining.service';
import { getMiners, getMinerById } from '../config/miners.config';

let bot: TelegramBot | null = null;
let isEnabled = false;
let authorizedChatId: string | null = null;

/**
 * Initialize Telegram bot
 */
export const initTelegramBot = (token: string, chatId: string): void => {
  try {
    if (!token || !chatId) {
      logger.warn('Telegram bot token or chat ID not provided. Bot disabled.');
      return;
    }

    authorizedChatId = chatId;
    bot = new TelegramBot(token, { polling: true });
    isEnabled = true;

    logger.info('Telegram bot initialized successfully');

    // Setup command handlers
    setupCommandHandlers();
    setupCallbackHandlers();

    // Send startup notification
    sendMessage('🚀 Mining Stack Bot is online and ready!');
  } catch (error) {
    logger.error('Failed to initialize Telegram bot:', error);
    isEnabled = false;
  }
};

/**
 * Check if message is from authorized chat
 */
const isAuthorized = (chatId: number): boolean => {
  return authorizedChatId === chatId.toString();
};

/**
 * Setup command handlers
 */
const setupCommandHandlers = (): void => {
  if (!bot) return;

  // /start - Welcome message
  bot.onText(/\/start/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;

    const welcomeMessage = `
🎉 *Welcome to Mining Stack Bot!*

Available commands:
/status - Farm overview
/miners - List all miners
/miner <name> - Get specific miner stats
/reboot <name> - Reboot a miner
/alerts - View active alerts
/help - Show this help message

Use inline buttons for easier navigation!
    `.trim();

    await bot?.sendMessage(msg.chat.id, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📊 Status' }, { text: '⛏️ Miners' }],
          [{ text: '🔔 Alerts' }, { text: '❓ Help' }],
        ],
        resize_keyboard: true,
      },
    });
  });

  // /status - Farm overview
  bot.onText(/\/status/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    await sendFarmStatus(msg.chat.id);
  });

  // /miners - List all miners
  bot.onText(/\/miners/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    await sendMinersList(msg.chat.id);
  });

  // /miner <name> - Specific miner stats
  bot.onText(/\/miner (.+)/, async (msg, match) => {
    if (!isAuthorized(msg.chat.id)) return;
    const minerName = match?.[1];
    if (minerName) {
      await sendMinerDetails(msg.chat.id, minerName);
    }
  });

  // /reboot <name> - Reboot miner
  bot.onText(/\/reboot (.+)/, async (msg, match) => {
    if (!isAuthorized(msg.chat.id)) return;
    const minerName = match?.[1];
    if (minerName) {
      await handleRebootRequest(msg.chat.id, minerName);
    }
  });

  // /alerts - Active alerts
  bot.onText(/\/alerts/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    await sendActiveAlerts(msg.chat.id);
  });

  // /help - Help message
  bot.onText(/\/help/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    
    const helpMessage = `
📚 *Mining Stack Bot Commands*

*Farm Management:*
/status - Overall farm statistics
/miners - List all configured miners

*Miner Control:*
/miner <name> - Detailed stats for a miner
/reboot <name> - Reboot a specific miner

*Alerts:*
/alerts - View active alerts

*Examples:*
\`/miner miner-1\`
\`/reboot miner-192-168-1-100\`

💡 Tip: Use the keyboard buttons for quick access!
    `.trim();

    await bot?.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  });

  // Handle keyboard button presses
  bot.on('message', async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    if (!msg.text) return;

    switch (msg.text) {
      case '📊 Status':
        await sendFarmStatus(msg.chat.id);
        break;
      case '⛏️ Miners':
        await sendMinersList(msg.chat.id);
        break;
      case '🔔 Alerts':
        await sendActiveAlerts(msg.chat.id);
        break;
      case '❓ Help':
        bot?.sendMessage(msg.chat.id, 'Use /help to see all available commands');
        break;
    }
  });
};

/**
 * Setup callback query handlers (for inline buttons)
 */
const setupCallbackHandlers = (): void => {
  if (!bot) return;

  bot.on('callback_query', async (query) => {
    if (!query.message || !isAuthorized(query.message.chat.id)) return;

    const data = query.data;
    if (!data) return;

    try {
      if (data.startsWith('miner_')) {
        const minerName = data.replace('miner_', '');
        await sendMinerDetails(query.message.chat.id, minerName);
      } else if (data.startsWith('reboot_confirm_')) {
        const minerName = data.replace('reboot_confirm_', '');
        await executeReboot(query.message.chat.id, minerName);
      } else if (data.startsWith('reboot_cancel_')) {
        await bot?.sendMessage(query.message.chat.id, '❌ Reboot cancelled');
      }

      // Answer callback query to remove loading state
      await bot?.answerCallbackQuery(query.id);
    } catch (error) {
      logger.error('Error handling callback query:', error);
      await bot?.answerCallbackQuery(query.id, { text: 'Error processing request' });
    }
  });
};

/**
 * Send farm status overview
 */
const sendFarmStatus = async (chatId: number): Promise<void> => {
  try {
    const stats = getMiningStats();
    
    const statusMessage = `
📊 *Farm Status*

⚡ Total Hashrate: *${stats.totalHashrate.toFixed(2)} TH/s*
📈 24h Average: *${stats.averageHashrate24h.toFixed(2)} TH/s*
⛏️ Active Miners: *${stats.activeMiners}* / ${stats.miners.length}
₿ Total Mined: *${stats.totalMined.toFixed(8)} BTC*

🕐 Last Update: ${new Date(stats.timestamp).toLocaleString()}
    `.trim();

    await bot?.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error sending farm status:', error);
    await bot?.sendMessage(chatId, '❌ Error fetching farm status');
  }
};

/**
 * Send list of all miners with inline buttons
 */
const sendMinersList = async (chatId: number): Promise<void> => {
  try {
    const miners = getMiners();
    const stats = getMiningStats();

    if (miners.length === 0) {
      await bot?.sendMessage(chatId, '⚠️ No miners configured');
      return;
    }

    let message = '⛏️ *Configured Miners:*\n\n';

    miners.forEach((miner) => {
      const minerStats = stats.miners.find(m => m.minerId === miner.name);
      const status = minerStats?.status || 'offline';
      const statusEmoji = status === 'online' ? '🟢' : status === 'error' ? '🔴' : '⚫';
      const hashrate = minerStats?.currentHashrate?.toFixed(2) || '0.00';
      
      message += `${statusEmoji} *${miner.alias || miner.name}*\n`;
      message += `   IP: \`${miner.ip}\` | ${hashrate} TH/s\n\n`;
    });

    // Create inline keyboard with miner buttons (max 8 miners per message)
    const buttons = miners.slice(0, 8).map(miner => [{
      text: `${miner.alias || miner.name}`,
      callback_data: `miner_${miner.name}`,
    }]);

    await bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    logger.error('Error sending miners list:', error);
    await bot?.sendMessage(chatId, '❌ Error fetching miners list');
  }
};

/**
 * Send detailed stats for a specific miner
 */
const sendMinerDetails = async (chatId: number, minerName: string): Promise<void> => {
  try {
    const miner = getMinerById(minerName);
    if (!miner) {
      await bot?.sendMessage(chatId, `❌ Miner "${minerName}" not found`);
      return;
    }

    const minerStats = getMinerStats(minerName);
    const statusEmoji = minerStats.status === 'online' ? '🟢' : 
                       minerStats.status === 'error' ? '🔴' : '⚫';

    const message = `
${statusEmoji} *${minerStats.name}*

📍 IP: \`${minerStats.ip}\`
🏷️ Model: ${minerStats.model}
📊 Status: *${minerStats.status.toUpperCase()}*

⚡ *Performance:*
Current: ${minerStats.currentHashrate.toFixed(2)} TH/s
Average: ${minerStats.averageHashrate.toFixed(2)} TH/s

🎯 *Shares:*
Accepted: ${minerStats.shares.accepted}
Rejected: ${minerStats.shares.rejected}

🌡️ *Hardware:*
Temperature: ${minerStats.hardware.temperature.toFixed(1)}°C
Fan Speed: ${minerStats.hardware.fanSpeed.toFixed(0)} RPM
Power: ${minerStats.hardware.powerUsage.toFixed(0)}W

⏱️ Uptime: ${formatUptime(minerStats.uptime)}
🕐 Last Seen: ${new Date(minerStats.lastSeen).toLocaleString()}
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Reboot', callback_data: `reboot_confirm_${minerName}` },
          { text: '🔙 Back', callback_data: 'miners_list' },
        ],
      ],
    };

    await bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error('Error sending miner details:', error);
    await bot?.sendMessage(chatId, `❌ Error fetching details for "${minerName}"`);
  }
};

/**
 * Handle reboot request with confirmation
 */
const handleRebootRequest = async (chatId: number, minerName: string): Promise<void> => {
  try {
    const miner = getMinerById(minerName);
    if (!miner) {
      await bot?.sendMessage(chatId, `❌ Miner "${minerName}" not found`);
      return;
    }

    const message = `⚠️ Are you sure you want to reboot *${miner.alias || miner.name}*?`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Confirm Reboot', callback_data: `reboot_confirm_${minerName}` },
          { text: '❌ Cancel', callback_data: `reboot_cancel_${minerName}` },
        ],
      ],
    };

    await bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error('Error handling reboot request:', error);
    await bot?.sendMessage(chatId, '❌ Error processing reboot request');
  }
};

/**
 * Execute miner reboot
 */
const executeReboot = async (chatId: number, minerName: string): Promise<void> => {
  try {
    await bot?.sendMessage(chatId, `🔄 Rebooting ${minerName}...`);
    
    const result = await restartMiner(minerName);
    
    if (result.success) {
      await bot?.sendMessage(chatId, `✅ ${result.message}`);
    } else {
      await bot?.sendMessage(chatId, `❌ Failed to reboot ${minerName}`);
    }
  } catch (error) {
    logger.error('Error executing reboot:', error);
    await bot?.sendMessage(chatId, `❌ Error rebooting ${minerName}`);
  }
};

/**
 * Send active alerts
 */
const sendActiveAlerts = async (chatId: number): Promise<void> => {
  try {
    // TODO: Integrate with Alertmanager API to get active alerts
    // For now, send a placeholder message
    const message = `
🔔 *Active Alerts*

No active alerts at the moment.

✅ All systems operational
    `.trim();

    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error sending active alerts:', error);
    await bot?.sendMessage(chatId, '❌ Error fetching alerts');
  }
};

/**
 * Send notification message
 */
export const sendMessage = async (message: string, options?: any): Promise<void> => {
  if (!bot || !isEnabled || !authorizedChatId) {
    logger.warn('Telegram bot not initialized or disabled');
    return;
  }

  try {
    await bot.sendMessage(authorizedChatId, message, options);
  } catch (error) {
    logger.error('Error sending Telegram message:', error);
  }
};

/**
 * Send alert notification
 */
export const sendAlert = async (alert: {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  miner?: string;
}): Promise<void> => {
  if (!bot || !isEnabled || !authorizedChatId) return;

  const emoji = alert.severity === 'critical' ? '🔥' : 
                alert.severity === 'warning' ? '⚠️' : 'ℹ️';

  const message = `
${emoji} *${alert.title}*

${alert.description}

${alert.miner ? `Miner: \`${alert.miner}\`` : ''}
Time: ${new Date().toLocaleString()}
  `.trim();

  try {
    await bot.sendMessage(authorizedChatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error sending alert notification:', error);
  }
};

/**
 * Test bot connection
 */
export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
  if (!bot || !isEnabled) {
    return { success: false, message: 'Bot not initialized' };
  }

  try {
    const me = await bot.getMe();
    await sendMessage('✅ Test message: Bot is working correctly!');
    return { 
      success: true, 
      message: `Connected as @${me.username}` 
    };
  } catch (error) {
    logger.error('Bot connection test failed:', error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

/**
 * Get bot status
 */
export const getBotStatus = (): { enabled: boolean; chatId: string | null } => {
  return {
    enabled: isEnabled,
    chatId: authorizedChatId,
  };
};

/**
 * Stop bot
 */
export const stopBot = (): void => {
  if (bot) {
    bot.stopPolling();
    bot = null;
    isEnabled = false;
    logger.info('Telegram bot stopped');
  }
};

/**
 * Format uptime in human-readable format
 */
const formatUptime = (seconds: number): string => {
  if (seconds === 0) return 'Offline';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.join(' ') || '<1m';
};
