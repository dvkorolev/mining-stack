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
import { getMiningStats, getMinerStats } from './mining.service';
import { getMiners, getMinerById } from '../config/miners.config';
import { rebootMiner, getMinerPools } from './miner-control.service';

let bot: TelegramBot | null = null;
let isEnabled = false;
let authorizedChatIds: Set<string> = new Set();

// Pagination state for each user
interface PaginationState {
  page: number;
  filter?: 'all' | 'online' | 'offline' | 'error';
}
const userPaginationState = new Map<string, PaginationState>();
const MINERS_PER_PAGE = 10;

/**
 * Initialize Telegram bot
 */
export const initTelegramBot = (token: string, chatIds: string | string[]): void => {
  try {
    if (!token || !chatIds) {
      logger.warn('Telegram bot token or chat IDs not provided. Bot disabled.', { service: 'telegram' });
      return;
    }

    // Parse chat IDs (comma-separated string or array)
    const chatIdArray = typeof chatIds === 'string' 
      ? chatIds.split(',').map(id => id.trim()).filter(id => id.length > 0)
      : chatIds;
    
    authorizedChatIds = new Set(chatIdArray);
    bot = new TelegramBot(token, { polling: true });
    isEnabled = true;

    logger.info('Telegram bot initialized successfully', { 
      service: 'telegram', 
      authorizedUsers: authorizedChatIds.size
    });

    // Setup command handlers
    setupCommandHandlers();
    setupCallbackHandlers();

    // Send startup notification to all authorized users
    for (const chatId of authorizedChatIds) {
      sendMessageToChat(chatId, '🚀 Mining Stack Bot is online and ready!');
    }
    logger.info('Telegram startup notifications sent', { service: 'telegram', count: authorizedChatIds.size });
  } catch (error) {
    logger.error('Failed to initialize Telegram bot:', { service: 'telegram', error });
    isEnabled = false;
  }
};

/**
 * Check if message is from authorized chat
 */
const isAuthorized = (chatId: number): boolean => {
  return authorizedChatIds.has(chatId.toString());
};

/**
 * Setup command handlers
 */
const setupCommandHandlers = (): void => {
  if (!bot) return;

  // /start - Welcome message
  bot.onText(/\/start/, async (msg) => {
    logger.info('Telegram: Received /start command', { 
      service: 'telegram', 
      chatId: msg.chat.id,
      username: msg.from?.username,
      authorized: isAuthorized(msg.chat.id)
    });
    
    if (!isAuthorized(msg.chat.id)) {
      logger.warn('Telegram: Unauthorized chat ID attempted /start', {
        service: 'telegram',
        chatId: msg.chat.id,
        authorizedChatIds: Array.from(authorizedChatIds)
      });
      return;
    }

    const welcomeMessage = `
🎉 *Welcome to Mining Stack Bot!*

Available commands:
/status - Farm overview
/miners - List all miners (paginated)
/miners offline - Show only offline miners
/miners error - Show only miners with errors
/find <keyword> - Search miners by name/IP
/miner <name> - Get specific miner stats
/reboot <name> - Reboot a miner
/pools <name> - View miner pool config
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

  // /miners - List all miners (with optional filter)
  bot.onText(/\/miners(?:\s+(offline|error|online))?/, async (msg, match) => {
    if (!isAuthorized(msg.chat.id)) return;
    const filter = match?.[1] as 'offline' | 'error' | 'online' | undefined;
    await sendMinersList(msg.chat.id, 0, filter || 'all');
  });

  // /find <keyword> - Search miners
  bot.onText(/\/find (.+)/, async (msg, match) => {
    if (!isAuthorized(msg.chat.id)) return;
    const keyword = match?.[1];
    if (keyword) {
      await searchMiners(msg.chat.id, keyword);
    }
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

  // /pools <name> - View pool configuration
  bot.onText(/\/pools (.+)/, async (msg, match) => {
    if (!isAuthorized(msg.chat.id)) return;
    const minerName = match?.[1];
    if (minerName) {
      await sendMinerPools(msg.chat.id, minerName);
    }
  });

  // /alerts - Active alerts
  bot.onText(/\/alerts/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    await sendActiveAlerts(msg.chat.id);
  });

  // /whoami - Get your chat ID (works for anyone)
  bot.onText(/\/whoami/, async (msg) => {
    const message = `
🆔 *Your Chat Information*

Chat ID: \`${msg.chat.id}\`
Chat Type: ${msg.chat.type}
${msg.from?.username ? `Username: @${msg.from.username}` : ''}
${msg.from?.first_name ? `Name: ${msg.from.first_name}` : ''}

${isAuthorized(msg.chat.id) ? '✅ You are authorized to use this bot' : '⚠️ This chat ID is not authorized'}

💡 Use this Chat ID in the Settings page to configure the bot.
    `.trim();

    await bot?.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
  });

  // /help - Help message
  bot.onText(/\/help/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    
    const helpMessage = `
📚 *Mining Stack Bot Commands*

*Farm Management:*
/status - Overall farm statistics
/miners - List all miners (paginated)
/miners offline - Show only offline miners
/miners error - Show only miners with errors
/miners online - Show only online miners

*Miner Explorer:*
/find <keyword> - Search by name, alias, or IP
  Example: \`/find 192.168\` or \`/find rig-1\`

*Miner Control:*
/miner <name> - Detailed stats for a miner
/reboot <name> - Reboot a specific miner
/pools <name> - View pool configuration

*Alerts:*
/alerts - View active alerts

*Other:*
/whoami - Get your chat ID
/help - Show this help message

*Navigation Tips:*
• Use ⬅️ Previous / Next ➡️ buttons to browse pages
• Use filter buttons (📋 All, ⚫ Offline, 🔴 Error) to filter miners
• Click on any miner name to see detailed stats
• Use keyboard buttons at bottom for quick access

*Examples:*
\`/miner miner-1\`
\`/reboot miner-192-168-1-100\`
\`/find 192.168.1\`
\`/miners offline\`
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
      // Pagination for miners list
      if (data.startsWith('miners_page_')) {
        const parts = data.replace('miners_page_', '').split('_');
        const page = parseInt(parts[0], 10);
        const filter = (parts[1] || 'all') as 'all' | 'online' | 'offline' | 'error';
        await sendMinersList(query.message.chat.id, page, filter);
      }
      // Miner selection
      else if (data.startsWith('miner_')) {
        const minerName = data.replace('miner_', '');
        await sendMinerDetails(query.message.chat.id, minerName);
      } 
      // Reboot actions
      else if (data.startsWith('reboot_confirm_')) {
        const minerName = data.replace('reboot_confirm_', '');
        await executeReboot(query.message.chat.id, minerName);
      } 
      else if (data.startsWith('reboot_cancel_')) {
        await bot?.sendMessage(query.message.chat.id, '❌ Reboot cancelled');
      }
      // Pool actions
      else if (data.startsWith('pools_')) {
        const minerName = data.replace('pools_', '');
        await sendMinerPools(query.message.chat.id, minerName);
      }
      // Quick actions
      else if (data === 'action_status') {
        await sendFarmStatus(query.message.chat.id);
      }
      else if (data === 'action_miners') {
        await sendMinersList(query.message.chat.id, 0, 'all');
      }
      else if (data === 'action_alerts') {
        await sendActiveAlerts(query.message.chat.id);
      }
      else if (data === 'miners_list') {
        await sendMinersList(query.message.chat.id, 0, 'all');
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
    logger.info('Telegram: Sending farm status', { service: 'telegram', chatId });
    const stats = getMiningStats();
    
    const statusMessage = `
📊 *Farm Status*

⚡ Total Hashrate: *${stats.totalHashrate.toFixed(2)} TH/s*
📈 24h Average: *${stats.averageHashrate24h.toFixed(2)} TH/s*
⛏️ Active Miners: *${stats.activeMiners}* / ${stats.miners.length}
₿ Total Mined: *${stats.totalMined.toFixed(8)} BTC*

🕐 Last Update: ${new Date(stats.timestamp).toLocaleString()}
    `.trim();

    // Add quick action buttons
    const keyboard = {
      inline_keyboard: [
        [
          { text: '⛏️ View Miners', callback_data: 'action_miners' },
          { text: '🔔 Alerts', callback_data: 'action_alerts' },
        ],
        [
          { text: '🔄 Refresh', callback_data: 'action_status' },
        ],
      ],
    };

    await bot?.sendMessage(chatId, statusMessage, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    logger.info('Telegram: Farm status sent successfully', { service: 'telegram', chatId });
  } catch (error) {
    logger.error('Telegram: Error sending farm status', { service: 'telegram', chatId, error });
    await bot?.sendMessage(chatId, '❌ Error fetching farm status');
  }
};

/**
 * Send list of all miners with pagination and filtering
 */
const sendMinersList = async (
  chatId: number, 
  page: number = 0, 
  filter: 'all' | 'online' | 'offline' | 'error' = 'all'
): Promise<void> => {
  try {
    logger.info('Telegram: Sending miners list', { service: 'telegram', chatId, page, filter });
    const allMiners = getMiners();
    const stats = getMiningStats();

    if (allMiners.length === 0) {
      await bot?.sendMessage(chatId, '⚠️ No miners configured');
      return;
    }

    // Filter miners based on status
    let filteredMiners = allMiners;
    if (filter !== 'all') {
      filteredMiners = allMiners.filter(miner => {
        const minerStats = stats.miners.find(m => m.minerId === miner.name);
        return minerStats?.status === filter;
      });
    }

    if (filteredMiners.length === 0) {
      const filterText = filter === 'all' ? '' : ` with status "${filter}"`;
      await bot?.sendMessage(chatId, `⚠️ No miners found${filterText}`);
      return;
    }

    // Store pagination state
    userPaginationState.set(chatId.toString(), { page, filter });

    // Calculate pagination
    const totalPages = Math.ceil(filteredMiners.length / MINERS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * MINERS_PER_PAGE;
    const endIdx = Math.min(startIdx + MINERS_PER_PAGE, filteredMiners.length);
    const minersToShow = filteredMiners.slice(startIdx, endIdx);

    // Summary overview
    const onlineCount = stats.miners.filter(m => m.status === 'online').length;
    const offlineCount = allMiners.length - onlineCount;
    const errorCount = stats.miners.filter(m => m.status === 'error').length;
    const totalHashrate = stats.totalHashrate.toFixed(2);

    const filterEmoji = filter === 'offline' ? '⚫' : filter === 'error' ? '🔴' : filter === 'online' ? '🟢' : '⛏️';
    const filterText = filter === 'all' ? 'All Miners' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Miners`;

    let message = `${filterEmoji} *${filterText}*\n\n`;
    message += `📊 Total: ${allMiners.length} miners\n`;
    message += `🟢 Online: ${onlineCount} | 🔴 Error: ${errorCount} | ⚫ Offline: ${offlineCount}\n`;
    message += `⚡ Total Hashrate: ${totalHashrate} TH/s\n\n`;
    
    if (filter !== 'all') {
      message += `Showing ${filteredMiners.length} ${filter} miner${filteredMiners.length !== 1 ? 's' : ''}\n`;
    }
    
    message += `📄 Page ${currentPage + 1}/${totalPages} (${startIdx + 1}-${endIdx} of ${filteredMiners.length})\n\n`;
    message += '💡 _Select a miner below for details_';

    // Create inline keyboard with 2 miners per row
    const minerButtons: any[] = [];
    for (let i = 0; i < minersToShow.length; i += 2) {
      const row = [];
      
      // First miner in row
      const miner1 = minersToShow[i];
      const stats1 = stats.miners.find(m => m.minerId === miner1.name);
      const status1 = stats1?.status || 'offline';
      const emoji1 = status1 === 'online' ? '🟢' : status1 === 'error' ? '🔴' : '⚫';
      row.push({
        text: `${emoji1} ${miner1.alias || miner1.name}`,
        callback_data: `miner_${miner1.name}`,
      });

      // Second miner in row (if exists)
      if (i + 1 < minersToShow.length) {
        const miner2 = minersToShow[i + 1];
        const stats2 = stats.miners.find(m => m.minerId === miner2.name);
        const status2 = stats2?.status || 'offline';
        const emoji2 = status2 === 'online' ? '🟢' : status2 === 'error' ? '🔴' : '⚫';
        row.push({
          text: `${emoji2} ${miner2.alias || miner2.name}`,
          callback_data: `miner_${miner2.name}`,
        });
      }

      minerButtons.push(row);
    }

    // Pagination controls
    const paginationRow = [];
    if (currentPage > 0) {
      paginationRow.push({ 
        text: '⬅️ Previous', 
        callback_data: `miners_page_${currentPage - 1}_${filter}` 
      });
    }
    if (currentPage < totalPages - 1) {
      paginationRow.push({ 
        text: 'Next ➡️', 
        callback_data: `miners_page_${currentPage + 1}_${filter}` 
      });
    }
    if (paginationRow.length > 0) {
      minerButtons.push(paginationRow);
    }

    // Filter buttons
    const filterRow = [];
    if (filter !== 'all') {
      filterRow.push({ text: '📋 All', callback_data: 'miners_page_0_all' });
    }
    if (filter !== 'offline') {
      filterRow.push({ text: '⚫ Offline', callback_data: 'miners_page_0_offline' });
    }
    if (filter !== 'error') {
      filterRow.push({ text: '🔴 Error', callback_data: 'miners_page_0_error' });
    }
    if (filterRow.length > 0) {
      minerButtons.push(filterRow);
    }

    // Action buttons at the bottom
    minerButtons.push([
      { text: '🔄 Refresh', callback_data: `miners_page_${currentPage}_${filter}` },
      { text: '📊 Farm Status', callback_data: 'action_status' },
    ]);

    await bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: minerButtons,
      },
    });
    logger.info('Telegram: Miners list sent', { 
      service: 'telegram', 
      chatId, 
      page: currentPage, 
      filter,
      totalMiners: filteredMiners.length 
    });
  } catch (error) {
    logger.error('Telegram: Error sending miners list', { service: 'telegram', chatId, error });
    await bot?.sendMessage(chatId, '❌ Error fetching miners list');
  }
};

/**
 * Search miners by keyword
 */
const searchMiners = async (chatId: number, keyword: string): Promise<void> => {
  try {
    logger.info('Telegram: Searching miners', { service: 'telegram', chatId, keyword });
    const allMiners = getMiners();
    const stats = getMiningStats();

    if (allMiners.length === 0) {
      await bot?.sendMessage(chatId, '⚠️ No miners configured');
      return;
    }

    // Search by name, alias, or IP
    const searchTerm = keyword.toLowerCase();
    const matchingMiners = allMiners.filter(miner => 
      miner.name.toLowerCase().includes(searchTerm) ||
      (miner.alias && miner.alias.toLowerCase().includes(searchTerm)) ||
      miner.ip.includes(searchTerm)
    );

    if (matchingMiners.length === 0) {
      await bot?.sendMessage(chatId, `🔍 No miners found matching "${keyword}"`);
      return;
    }

    let message = `🔍 *Search Results for "${keyword}"*\n\n`;
    message += `Found ${matchingMiners.length} miner${matchingMiners.length !== 1 ? 's' : ''}\n\n`;
    message += '💡 _Select a miner below for details_';

    // Create inline keyboard with matching miners
    const minerButtons: any[] = [];
    const maxResults = 20; // Limit search results
    const minersToShow = matchingMiners.slice(0, maxResults);

    for (let i = 0; i < minersToShow.length; i += 2) {
      const row = [];
      
      // First miner in row
      const miner1 = minersToShow[i];
      const stats1 = stats.miners.find(m => m.minerId === miner1.name);
      const status1 = stats1?.status || 'offline';
      const emoji1 = status1 === 'online' ? '🟢' : status1 === 'error' ? '🔴' : '⚫';
      row.push({
        text: `${emoji1} ${miner1.alias || miner1.name}`,
        callback_data: `miner_${miner1.name}`,
      });

      // Second miner in row (if exists)
      if (i + 1 < minersToShow.length) {
        const miner2 = minersToShow[i + 1];
        const stats2 = stats.miners.find(m => m.minerId === miner2.name);
        const status2 = stats2?.status || 'offline';
        const emoji2 = status2 === 'online' ? '🟢' : status2 === 'error' ? '🔴' : '⚫';
        row.push({
          text: `${emoji2} ${miner2.alias || miner2.name}`,
          callback_data: `miner_${miner2.name}`,
        });
      }

      minerButtons.push(row);
    }

    if (matchingMiners.length > maxResults) {
      message += `\n\n⚠️ _Showing first ${maxResults} of ${matchingMiners.length} results. Refine your search for better results._`;
    }

    // Add back button
    minerButtons.push([
      { text: '⬅️ Back to Miners', callback_data: 'miners_page_0_all' },
    ]);

    await bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: minerButtons,
      },
    });
    logger.info('Telegram: Search results sent', { 
      service: 'telegram', 
      chatId, 
      keyword,
      resultsCount: matchingMiners.length 
    });
  } catch (error) {
    logger.error('Telegram: Error searching miners', { service: 'telegram', chatId, keyword, error });
    await bot?.sendMessage(chatId, '❌ Error searching miners');
  }
};

/**
 * Send detailed stats for a specific miner
 */
const sendMinerDetails = async (chatId: number, minerName: string): Promise<void> => {
  try {
    logger.info('Telegram: Sending miner details', { service: 'telegram', chatId, minerName });
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
          { text: '🔄 Reboot Miner', callback_data: `reboot_confirm_${minerName}` },
        ],
        [
          { text: '🌊 View Pools', callback_data: `pools_${minerName}` },
          { text: '🔄 Refresh Stats', callback_data: `miner_${minerName}` },
        ],
        [
          { text: '⬅️ Back to Miners', callback_data: 'miners_list' },
        ],
      ],
    };

    await bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    logger.info('Telegram: Miner details sent', { service: 'telegram', chatId, minerName });
  } catch (error) {
    logger.error('Telegram: Error sending miner details', { service: 'telegram', chatId, minerName, error });
    await bot?.sendMessage(chatId, `❌ Error fetching details for "${minerName}"`);
  }
};

/**
 * Handle reboot request with confirmation
 */
const handleRebootRequest = async (chatId: number, minerName: string): Promise<void> => {
  try {
    logger.info('Telegram: Reboot request received', { service: 'telegram', chatId, minerName });
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
    logger.info('Telegram: Executing reboot', { service: 'telegram', chatId, minerName });
    await bot?.sendMessage(chatId, `🔄 Rebooting ${minerName}...`);
    
    const result = await rebootMiner(minerName);
    
    if (result.success) {
      await bot?.sendMessage(chatId, `✅ ${result.message}`);
      logger.info('Telegram: Reboot successful', { service: 'telegram', chatId, minerName });
    } else {
      await bot?.sendMessage(chatId, `❌ ${result.message}`);
      logger.warn('Telegram: Reboot failed', { service: 'telegram', chatId, minerName, message: result.message });
    }
  } catch (error) {
    logger.error('Telegram: Error executing reboot', { service: 'telegram', chatId, minerName, error });
    await bot?.sendMessage(chatId, `❌ Error rebooting ${minerName}`);
  }
};

/**
 * Send miner pool configuration
 */
const sendMinerPools = async (chatId: number, minerName: string): Promise<void> => {
  try {
    logger.info('Telegram: Fetching pool configuration', { service: 'telegram', chatId, minerName });
    const miner = getMinerById(minerName);
    if (!miner) {
      await bot?.sendMessage(chatId, `❌ Miner "${minerName}" not found`);
      return;
    }

    const result = await getMinerPools(minerName);
    
    if (!result.success || !result.pools || result.pools.length === 0) {
      const errorMessage = `⚠️ *Pool Configuration Unavailable*\n\n` +
        `Miner: *${miner.alias || miner.name}*\n` +
        `IP: \`${miner.ip}\`\n\n` +
        `${result.message || 'Unable to retrieve pool data'}`;
      
      // Add back button
      const keyboard = {
        inline_keyboard: [
          [{ text: '⬅️ Back to Miner', callback_data: `miner_${minerName}` }],
        ],
      };
      
      await bot?.sendMessage(chatId, errorMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    let message = `🌊 *Pool Configuration*\n\n`;
    message += `Miner: *${miner.alias || miner.name}*\n`;
    message += `IP: \`${miner.ip}\`\n\n`;

    result.pools.forEach((pool, index) => {
      message += `*Pool ${index + 1}:*\n`;
      message += `URL: \`${pool.url}\`\n`;
      message += `User: \`${pool.user}\`\n`;
      if (index < result.pools!.length - 1) message += '\n';
    });

    // Add navigation buttons
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔙 Back to Miner', callback_data: `miner_${minerName}` },
          { text: '⛏️ All Miners', callback_data: 'miners_list' },
        ],
      ],
    };

    await bot?.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    logger.info('Telegram: Pool configuration sent', { service: 'telegram', chatId, minerName, poolCount: result.pools!.length });
  } catch (error) {
    logger.error('Telegram: Error sending pool configuration', { service: 'telegram', chatId, minerName, error });
    await bot?.sendMessage(chatId, `❌ Error fetching pool configuration for "${minerName}"`);
  }
};

/**
 * Send active alerts
 */
const sendActiveAlerts = async (chatId: number): Promise<void> => {
  try {
    logger.info('Telegram: Fetching active alerts', { service: 'telegram', chatId });
    
    // Import alert service to get active alerts
    const { getActiveAlerts } = require('./alert.service');
    const alerts = getActiveAlerts();

    if (alerts.length === 0) {
      const message = `
🔔 *Active Alerts*

No active alerts at the moment.

✅ All systems operational
      `.trim();

      await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      return;
    }

    // Group alerts by severity
    const critical = alerts.filter((a: any) => a.severity === 'critical');
    const warning = alerts.filter((a: any) => a.severity === 'warning');
    const info = alerts.filter((a: any) => a.severity === 'info');

    let message = `🔔 *Active Alerts* (${alerts.length})\n\n`;

    if (critical.length > 0) {
      message += `🔥 *Critical (${critical.length}):*\n`;
      critical.slice(0, 5).forEach((alert: any) => {
        message += `• ${alert.summary}\n`;
        if (alert.miner) message += `  Miner: \`${alert.miner}\`\n`;
      });
      if (critical.length > 5) {
        message += `  _...and ${critical.length - 5} more_\n`;
      }
      message += '\n';
    }

    if (warning.length > 0) {
      message += `⚠️ *Warning (${warning.length}):*\n`;
      warning.slice(0, 5).forEach((alert: any) => {
        message += `• ${alert.summary}\n`;
        if (alert.miner) message += `  Miner: \`${alert.miner}\`\n`;
      });
      if (warning.length > 5) {
        message += `  _...and ${warning.length - 5} more_\n`;
      }
      message += '\n';
    }

    if (info.length > 0) {
      message += `ℹ️ *Info (${info.length}):*\n`;
      info.slice(0, 3).forEach((alert: any) => {
        message += `• ${alert.summary}\n`;
      });
      if (info.length > 3) {
        message += `  _...and ${info.length - 3} more_\n`;
      }
    }

    // Add refresh button
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Refresh', callback_data: 'action_alerts' },
          { text: '📊 Farm Status', callback_data: 'action_status' },
        ],
      ],
    };

    await bot?.sendMessage(chatId, message.trim(), { 
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    logger.info('Telegram: Active alerts sent', { service: 'telegram', chatId, alertCount: alerts.length });
  } catch (error) {
    logger.error('Telegram: Error sending active alerts', { service: 'telegram', chatId, error });
    await bot?.sendMessage(chatId, '❌ Error fetching alerts');
  }
};

/**
 * Send message to a specific chat
 */
const sendMessageToChat = async (chatId: string, message: string, options?: any): Promise<void> => {
  if (!bot || !isEnabled) {
    logger.warn('Telegram bot not initialized or disabled', { service: 'telegram' });
    return;
  }

  try {
    await bot.sendMessage(chatId, message, options);
    logger.debug('Telegram: Message sent to chat', { service: 'telegram', chatId: chatId.substring(0, 4) + '***' });
  } catch (error) {
    logger.error('Telegram: Error sending message', { service: 'telegram', chatId, error });
  }
};

/**
 * Send notification message to all authorized users
 */
export const sendMessage = async (message: string, options?: any): Promise<void> => {
  if (!bot || !isEnabled || authorizedChatIds.size === 0) {
    logger.warn('Telegram bot not initialized or disabled', { service: 'telegram' });
    return;
  }

  for (const chatId of authorizedChatIds) {
    await sendMessageToChat(chatId, message, options);
  }
  logger.info('Telegram: Message sent to all users', { service: 'telegram', userCount: authorizedChatIds.size });
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
  if (!bot || !isEnabled || authorizedChatIds.size === 0) return;

  logger.info('Telegram: Sending alert', { 
    service: 'telegram', 
    severity: alert.severity, 
    title: alert.title, 
    miner: alert.miner 
  });

  const emoji = alert.severity === 'critical' ? '🔥' : 
                alert.severity === 'warning' ? '⚠️' : 'ℹ️';

  const message = `
${emoji} *${alert.title}*

${alert.description}

${alert.miner ? `Miner: \`${alert.miner}\`` : ''}
Time: ${new Date().toLocaleString()}
  `.trim();

  for (const chatId of authorizedChatIds) {
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Telegram: Error sending alert to chat', { service: 'telegram', chatId, error });
    }
  }
  logger.info('Telegram: Alert sent to all users', { service: 'telegram', severity: alert.severity, userCount: authorizedChatIds.size });
};

/**
 * Test bot connection
 */
export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
  if (!bot || !isEnabled) {
    logger.warn('Telegram: Test connection failed - bot not initialized', { service: 'telegram' });
    return { success: false, message: 'Bot not initialized' };
  }

  try {
    logger.info('Telegram: Testing connection', { service: 'telegram' });
    const me = await bot.getMe();
    await sendMessage('✅ Test message: Bot is working correctly!');
    logger.info('Telegram: Connection test successful', { service: 'telegram', username: me.username });
    return { 
      success: true, 
      message: `Connected as @${me.username}` 
    };
  } catch (error) {
    logger.error('Telegram: Connection test failed', { service: 'telegram', error });
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

/**
 * Get bot status
 */
export const getBotStatus = (): { enabled: boolean; chatIds: string[] } => {
  return {
    enabled: isEnabled,
    chatIds: Array.from(authorizedChatIds),
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
    logger.info('Telegram bot stopped', { service: 'telegram' });
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
