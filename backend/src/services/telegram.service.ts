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

// User context and state management
interface UserContext {
  lastMessageId?: number;
  currentView: 'status' | 'miners' | 'miner_details' | 'alerts' | 'pools' | 'help';
  viewData?: any;
  navigationStack: NavigationView[];
  lastUpdated: number;
}

interface NavigationView {
  type: 'status' | 'miners' | 'miner_details' | 'alerts' | 'pools' | 'help';
  data?: any;
  messageId?: number;
}

interface PaginationState {
  page: number;
  filter?: 'all' | 'online' | 'offline' | 'error';
}

const userContexts = new Map<string, UserContext>();
const userPaginationState = new Map<string, PaginationState>();
const sentAlertIds = new Map<string, number>(); // Track sent alert notifications with timestamps
const lastRefreshTime = new Map<string, number>(); // Dedupe rapid refresh clicks
const alertMessageIds = new Map<string, { messageId: number; updatedAt: number }>(); // Track alert message per chat for updates
const MINERS_PER_PAGE = 10;
const REFRESH_DEBOUNCE_MS = 1000; // Ignore refresh within 1s
const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ALERT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ALERT_DEDUP_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_TRACKED_ALERTS = 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let cleanupTimer: NodeJS.Timeout | null = null;

const runCleanup = (): void => {
  const now = Date.now();

  for (const [chatId, context] of userContexts.entries()) {
    if (now - context.lastUpdated > CONTEXT_TTL_MS) {
      userContexts.delete(chatId);
      userPaginationState.delete(chatId);
    }
  }

  for (const [chatId, entry] of alertMessageIds.entries()) {
    if (now - entry.updatedAt > ALERT_MESSAGE_TTL_MS) {
      alertMessageIds.delete(chatId);
    }
  }

  for (const [alertId, timestamp] of sentAlertIds.entries()) {
    if (now - timestamp > ALERT_DEDUP_TTL_MS) {
      sentAlertIds.delete(alertId);
    }
  }
};

type TelegramSendMeta = {
  description?: string;
  chatId?: string | number;
  messageId?: number;
};

const telegramSendFailureState = {
  consecutiveFailures: 0,
  lastFailureAt: 0,
  alertRaised: false,
};

const telegramApi = {
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
    meta: TelegramSendMeta = {}
  ): Promise<TelegramBot.Message> {
    const activeBot = bot;
    if (!activeBot || !isEnabled) {
      throw new Error('Telegram bot not initialized or disabled');
    }

    const description = meta.description || 'sendMessage';

    try {
      const result = await withTelegramRetry(
        () => activeBot.sendMessage(chatId, text, options),
        {
          description,
          chatId: meta.chatId ?? chatId,
          messageId: meta.messageId,
        }
      );

      if (telegramSendFailureState.consecutiveFailures > 0) {
        logger.info('Telegram adapter: sendMessage recovered', {
          service: 'telegram',
          chatId,
          previousFailures: telegramSendFailureState.consecutiveFailures,
        });
      }

      telegramSendFailureState.consecutiveFailures = 0;
      telegramSendFailureState.alertRaised = false;

      return result;
    } catch (error: any) {
      telegramSendFailureState.consecutiveFailures += 1;
      telegramSendFailureState.lastFailureAt = Date.now();

      const errMsg = getTelegramErrorMessage(error) || error?.message || String(error);

      logger.error('Telegram adapter: sendMessage failed', {
        service: 'telegram',
        chatId,
        description,
        error: errMsg,
        consecutiveFailures: telegramSendFailureState.consecutiveFailures,
      });

      if (
        !telegramSendFailureState.alertRaised &&
        telegramSendFailureState.consecutiveFailures >= TELEGRAM_SEND_FAILURE_THRESHOLD
      ) {
        telegramSendFailureState.alertRaised = true;
        logger.error('Telegram adapter: repeated sendMessage failures', {
          service: 'telegram',
          consecutiveFailures: telegramSendFailureState.consecutiveFailures,
          lastFailureAt: telegramSendFailureState.lastFailureAt,
        });
      }

      throw error;
    }
  },
};

const safeTelegramSend = async (
  chatId: number | string,
  text: string,
  options?: TelegramBot.SendMessageOptions,
  meta: TelegramSendMeta = {}
): Promise<void> => {
  try {
    await telegramApi.sendMessage(chatId, text, options, meta);
  } catch (error: any) {
    logger.error('Telegram adapter: safe send failed', {
      service: 'telegram',
      chatId,
      description: meta.description || 'safeSend',
      error: error?.message || String(error),
    });
  }
};

const ensureCleanupTimer = (): void => {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  }
};

const stopCleanupTimer = (): void => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
};

const disableTelegramBot = async (reason: string, details?: Record<string, any>): Promise<void> => {
  const shutdownDetails = details || {};

  if (bot) {
    try {
      await bot.stopPolling();
    } catch (error) {
      logger.warn('Telegram: stopPolling failed during disable', {
        service: 'telegram',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  bot = null;
  isEnabled = false;
  authorizedChatIds.clear();
  stopCleanupTimer();

  logger.error('Telegram bot disabled', {
    service: 'telegram',
    reason,
    ...shutdownDetails,
  });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const TELEGRAM_MAX_RETRIES = 3;
const TELEGRAM_RETRY_BASE_DELAY_MS = 500;
const TELEGRAM_SEND_FAILURE_THRESHOLD = 3;

const getTelegramErrorMessage = (error: any): string => {
  return (error?.response?.body?.description || error?.message || String(error) || '').toLowerCase();
};

const shouldRetryTelegramError = (error: any): boolean => {
  const status = error?.response?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }

  const errMsg = getTelegramErrorMessage(error);
  if (!errMsg) return false;

  return (
    errMsg.includes('retry later') ||
    errMsg.includes('too many requests') ||
    errMsg.includes('flood') ||
    errMsg.includes('timeout') ||
    errMsg.includes('terminated by other getupdates request') ||
    errMsg.includes('connection') ||
    errMsg.includes('conflict') ||
    errMsg.includes('bad gateway') ||
    errMsg.includes('service unavailable')
  );
};

const withTelegramRetry = async <T>(
  action: () => Promise<T>,
  meta: { description: string; chatId?: string | number; messageId?: number }
): Promise<T> => {
  let attempt = 0;
  let delay = TELEGRAM_RETRY_BASE_DELAY_MS;

  while (true) {
    attempt += 1;
    try {
      return await action();
    } catch (error: any) {
      if (attempt >= TELEGRAM_MAX_RETRIES || !shouldRetryTelegramError(error)) {
        throw error;
      }

      const errMsg = getTelegramErrorMessage(error) || 'unknown error';
      const retryAfter = Number(error?.response?.body?.parameters?.retry_after);
      const waitMs = Number.isFinite(retryAfter) ? Math.max((retryAfter + 1) * 1000, delay) : delay;

      logger.warn('Telegram: transient API failure, retrying', {
        service: 'telegram',
        description: meta.description,
        chatId: meta.chatId,
        messageId: meta.messageId,
        attempt,
        waitMs,
        error: errMsg,
      });

      await sleep(waitMs);
      delay = Math.min(delay * 2, TELEGRAM_RETRY_BASE_DELAY_MS * 8);
    }
  }
};

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

    ensureCleanupTimer();

    // Setup command handlers
    setupCommandHandlers();
    setupCallbackHandlers();

    // Send startup main menu to all authorized users with retry/backoff
    (async () => {
      let failureCount = 0;
      const MAX_FAILURES = 3;

      for (const chatId of authorizedChatIds) {
        const idNum = Number(chatId);
        const description = 'startup notification';

        try {
          await withTelegramRetry(async () => {
            if (!Number.isNaN(idNum)) {
              await sendMainMenu(idNum);
            } else {
              await sendMessageToChat(chatId, '🚀 Mining Stack Bot is online and ready!');
            }
          }, { description, chatId });
        } catch (error: any) {
          failureCount += 1;
          const errMsg = error?.message || String(error);
          logger.error('Telegram: startup notification failed after retries', {
            service: 'telegram',
            chatId,
            error: errMsg,
            failureCount,
          });

          if (failureCount >= MAX_FAILURES) {
            await disableTelegramBot('Startup notifications failed', {
              failures: failureCount,
            });
            return;
          }
        }
      }

      logger.info('Telegram startup notifications completed', {
        service: 'telegram',
        totalChats: authorizedChatIds.size,
        failures: failureCount,
      });
    })().catch(error => {
      logger.error('Telegram: unexpected error during startup notifications', {
        service: 'telegram',
        error: error?.message || String(error),
      });
    });
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
 * Get or create user context
 */
const getUserContext = (chatId: string): UserContext => {
  let context = userContexts.get(chatId);
  if (!context) {
    context = {
      currentView: 'status',
      navigationStack: [],
      lastUpdated: Date.now(),
    };
    userContexts.set(chatId, context);
  } else {
    context.lastUpdated = Date.now();
  }
  return context;
};

const trimSentAlerts = (): void => {
  while (sentAlertIds.size > MAX_TRACKED_ALERTS) {
    const oldestKey = sentAlertIds.keys().next().value as string | undefined;
    if (!oldestKey) break;
    sentAlertIds.delete(oldestKey);
  }
};

/**
 * Push view to navigation stack
 */
const pushView = (chatId: string, view: NavigationView): void => {
  const context = getUserContext(chatId);
  context.navigationStack.push(view);
  context.currentView = view.type;
  context.viewData = view.data;
};

/**
 * Pop view from navigation stack
 */
const popView = (chatId: string): NavigationView | null => {
  const context = getUserContext(chatId);
  if (context.navigationStack.length > 1) {
    context.navigationStack.pop();
    const previousView = context.navigationStack[context.navigationStack.length - 1];
    context.currentView = previousView.type;
    context.viewData = previousView.data;
    return previousView;
  }
  return null;
};

/**
 * Get view name for display
 */
const getViewName = (viewType: string): string => {
  const names: Record<string, string> = {
    status: 'Status',
    miners: 'Miners',
    miner_details: 'Miner Details',
    alerts: 'Alerts',
    pools: 'Pools',
    help: 'Help',
  };
  return names[viewType] || 'Home';
};

/**
 * Send or edit message based on context
 */
const sendOrEditMessage = async (
  chatId: number,
  text: string,
  keyboard?: any,
  viewType?: string,
  viewData?: any,
  messageId?: number,  // Optional: specific message ID to edit (from callback query)
  isRefresh: boolean = false  // If true, never fall back to sendMessage
): Promise<void> => {
  const activeBot = bot;
  if (!activeBot) {
    logger.warn('Telegram: sendOrEditMessage called before bot initialization', {
      service: 'telegram',
      chatId,
    });
    return;
  }

  const context = getUserContext(chatId.toString());
  
  // Use provided messageId or fall back to context
  const targetMessageId = messageId || context.lastMessageId;
  
  try {
    if (!targetMessageId) {
      if (isRefresh) {
        logger.info(`edit failed: no message_id (refresh ignored)`);
        return; // Refresh with no target = no-op
      }
      // No message ID and not refresh = send new message
      logger.info(`no message_id (sending new)`);
      const msg = await withTelegramRetry(() => activeBot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }), {
        description: 'sendMessage',
        chatId,
      });
      if (msg) {
        context.lastMessageId = msg.message_id;
        if (viewType) {
          pushView(chatId.toString(), {
            type: viewType as any,
            data: viewData,
            messageId: msg.message_id,
          });
        }
      }
      return;
    }

    // Try to edit existing message
    logger.info(`editing message_id=${targetMessageId}`);
    await withTelegramRetry(() => activeBot.editMessageText(text, {
      chat_id: chatId,
      message_id: targetMessageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }), {
      description: 'editMessageText',
      chatId,
      messageId: targetMessageId,
    });
    logger.info(`editing message_id=${targetMessageId} → edited ok`);
    
    // Update context with this message ID
    context.lastMessageId = targetMessageId;
    
    // Update navigation stack if view type provided
    if (viewType) {
      const currentView = context.navigationStack[context.navigationStack.length - 1];
      if (!currentView || currentView.type !== viewType) {
        pushView(chatId.toString(), {
          type: viewType as any,
          data: viewData,
          messageId: targetMessageId,
        });
      } else {
        currentView.data = viewData;
        currentView.messageId = targetMessageId;
      }
    }
  } catch (error: any) {
    const errMsg = getTelegramErrorMessage(error);

    if (errMsg.includes('message is not modified')) {
      logger.info(`edit failed: ${errMsg} (ignored)`);
      return;
    }

    const isNotFound = errMsg.includes('message to edit not found') ||
      errMsg.includes('message to delete not found') ||
      errMsg.includes("message can't be edited") ||
      errMsg.includes("message can't be deleted") ||
      errMsg.includes('message_id_invalid') ||
      errMsg.includes('message is too old') ||
      errMsg.includes('message to modify not found');

    if (isRefresh) {
      logger.info(`edit failed: ${errMsg} (refresh ignored)`);
      return;
    }

    if (isNotFound) {
      logger.info(`edit failed: ${errMsg} (sending new)`);
      const msg = await withTelegramRetry(() => activeBot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }), {
        description: 'sendMessage (fallback after edit failure)',
        chatId,
      });
      if (msg) {
        context.lastMessageId = msg.message_id;
        if (viewType) {
          pushView(chatId.toString(), {
            type: viewType as any,
            data: viewData,
            messageId: msg.message_id,
          });
        }
      }
    } else {
      logger.info(`edit failed: ${errMsg}`);
    }
  }
};

/**
 * Send main menu (used on /start and on startup)
 */
const sendMainMenu = async (chatId: number, isRefresh: boolean = false, messageId?: number): Promise<void> => {
  const welcomeMessage = `
🎉 *Welcome to Mining Stack Bot!*

I'm your mining farm assistant. Use the buttons below to get started, or type /help for all commands.

💡 *Quick Start:*
• View farm status and stats
• Browse and search miners
• Check active alerts
• Get help and tips
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📊 Farm Status', callback_data: 'action_status' },
        { text: '⛏️ View Miners', callback_data: 'action_miners' },
      ],
      [
        { text: '🔔 Alerts', callback_data: 'action_alerts' },
        { text: '❓ Help', callback_data: 'help_main' },
      ],
    ],
  };

  await sendOrEditMessage(chatId, welcomeMessage, keyboard, 'status', undefined, messageId, isRefresh);
};

/**
 * Send interactive help menu
 */
const sendInteractiveHelp = async (chatId: number, category?: string): Promise<void> => {
  try {
    if (!category) {
      // Main help menu
      const message = `
📚 *Mining Stack Bot Help*

Select a category to learn more:
      `.trim();

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🏠 Farm Commands', callback_data: 'help_farm' },
            { text: '⛏️ Miner Commands', callback_data: 'help_miners' },
          ],
          [
            { text: '🔔 Alerts', callback_data: 'help_alerts' },
            { text: '🔍 Search & Filter', callback_data: 'help_search' },
          ],
          [
            { text: '💡 Tips & Tricks', callback_data: 'help_tips' },
            { text: '📖 Full Command List', callback_data: 'help_full' },
          ],
          [
            { text: '🏠 Main Menu', callback_data: 'main_menu' },
          ],
        ],
      };

      await sendOrEditMessage(chatId, message, keyboard, 'help');
    } else {
      // Category-specific help
      let message = '';
      let backButton = { text: '⬅️ Back to Help Menu', callback_data: 'help_main' };

      switch (category) {
        case 'farm':
          message = `
🏠 *Farm Commands*

/status - Overall farm statistics
  Shows total hashrate, active miners, and farm overview

/miners - List all miners (paginated)
  Browse through all your miners, 10 per page

/miners offline - Show only offline miners
/miners error - Show only miners with errors
/miners online - Show only online miners

💡 Tip: Use the filter buttons to quickly find problematic miners
          `.trim();
          break;

        case 'miners':
          message = `
⛏️ *Miner Commands*

/miner <name> - Detailed stats for a miner
  Example: \`/miner rig-1\`
  Shows hashrate, temperature, shares, uptime

/reboot <name> - Reboot a specific miner
  Example: \`/reboot rig-1\`
  Requires confirmation before rebooting

/pools <name> - View pool configuration
  Example: \`/pools rig-1\`
  Shows configured mining pools

💡 Tip: Click on any miner name in the list to see its details
          `.trim();
          break;

        case 'alerts':
          message = `
🔔 *Alerts*

/alerts - View active alerts
  Shows all current alerts with severity levels

*Alert Types:*
🔴 Critical - Requires immediate attention
⚠️ Warning - Should be addressed soon
ℹ️ Info - Informational only

💡 Tip: Alerts are sent automatically when issues are detected
          `.trim();
          break;

        case 'search':
          message = `
🔍 *Search & Filter*

/find <keyword> - Search miners
  Search by name, alias, or IP address
  Examples:
  • \`/find 192.168\` - Find by IP
  • \`/find rig-1\` - Find by name
  • \`/find main\` - Find by alias

*Filter Buttons:*
📋 All - Show all miners
⚫ Offline - Show only offline miners
🔴 Error - Show only miners with errors

💡 Tip: Use filters to quickly identify problems
          `.trim();
          break;

        case 'tips':
          message = `
💡 *Tips & Tricks*

*Navigation:*
• Use ⬅️ Previous / Next ➡️ buttons to browse pages
• Click miner names for quick details
• Use filter buttons to find specific miners

*Keyboard Shortcuts:*
• 📊 Status - Quick farm overview
• ⛏️ Miners - View all miners
• 🔔 Alerts - Check alerts
• ❓ Help - Show this help

*Best Practices:*
• Check /status daily for farm health
• Use /miners offline to find down miners
• Monitor alerts for critical issues
• Use /find for quick miner lookup

💡 Tip: Bookmark common commands for faster access
          `.trim();
          break;

        case 'full':
          message = `
📖 *Full Command List*

*Farm Management:*
/status - Farm overview
/miners [filter] - List miners

*Miner Control:*
/miner <name> - Miner details
/reboot <name> - Reboot miner
/pools <name> - Pool config

*Search & Filter:*
/find <keyword> - Search miners
/miners offline - Offline miners
/miners error - Error miners
/miners online - Online miners

*Alerts:*
/alerts - Active alerts

*Other:*
/whoami - Get your chat ID
/help - Show this help

*Examples:*
\`/miner rig-1\`
\`/reboot rig-1\`
\`/find 192.168\`
\`/miners offline\`
          `.trim();
          break;

        default:
          message = '❌ Unknown help category';
      }

      const keyboard = {
        inline_keyboard: [[backButton]],
      };

      await sendOrEditMessage(chatId, message, keyboard, 'help', { category });
    }
  } catch (error) {
    logger.error('Telegram: Error sending help', { service: 'telegram', chatId, error });
    await bot?.sendMessage(chatId, '❌ Error loading help');
  }
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

    // Clear user context to force fresh main menu (important after deleting messages)
    const chatIdStr = msg.chat.id.toString();
    userContexts.delete(chatIdStr);
    userPaginationState.delete(chatIdStr);
    
    // Send fresh main menu (no messageId = always new message)
    await sendMainMenu(msg.chat.id);
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

  // /help - Interactive help message
  bot.onText(/\/help/, async (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    await sendInteractiveHelp(msg.chat.id);
  });

  // No keyboard button handlers needed - using inline buttons only
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

    const messageId = query.message.message_id;
    const chatId = query.message.chat.id;
    
    logger.info(`cb.message_id=${messageId}, chatId=${chatId}, action=${data}`);
    
    // Dedupe rapid refresh clicks
    const isRefreshAction = data === 'action_status' || data === 'action_alerts' || data === 'action_miners' ||
                           data.startsWith('miners_page_') || data.startsWith('miner_');
    
    if (isRefreshAction) {
      const dedupeKey = `${chatId}_${messageId}`;
      const lastTime = lastRefreshTime.get(dedupeKey) || 0;
      const now = Date.now();
      
      if (now - lastTime < REFRESH_DEBOUNCE_MS) {
        logger.info(`refresh debounced: <${REFRESH_DEBOUNCE_MS}ms since last`);
        await bot?.answerCallbackQuery(query.id);
        return;
      }
      
      lastRefreshTime.set(dedupeKey, now);
      
      // Cleanup old entries (keep last 100)
      if (lastRefreshTime.size > 100) {
        const keys = Array.from(lastRefreshTime.keys());
        keys.slice(0, lastRefreshTime.size - 100).forEach(k => lastRefreshTime.delete(k));
      }
    }
    
    // Update user context with this message ID
    const context = getUserContext(chatId.toString());
    context.lastMessageId = messageId;

    try {
      // Navigation back
      if (data === 'nav_back') {
        const previousView = popView(query.message.chat.id.toString());
        if (previousView) {
          // Restore previous view based on type
          switch (previousView.type) {
            case 'status':
              await sendFarmStatus(query.message.chat.id, true, messageId);
              break;
            case 'miners':
              const minerData = previousView.data || { page: 0, filter: 'all' };
              await sendMinersList(query.message.chat.id, minerData.page, minerData.filter, true, messageId);
              break;
            case 'miner_details':
              if (previousView.data?.minerName) {
                await sendMinerDetails(query.message.chat.id, previousView.data.minerName, true, messageId);
              }
              break;
            case 'alerts':
              await sendActiveAlerts(query.message.chat.id, true, messageId);
              break;
            case 'pools':
              if (previousView.data?.minerName) {
                await sendMinerPools(query.message.chat.id, previousView.data.minerName, true, messageId);
              }
              break;
            default:
              await sendMainMenu(query.message.chat.id, true, messageId);
          }
        }
      }
      // Pagination for miners list (refresh = true)
      else if (data.startsWith('miners_page_')) {
        const parts = data.replace('miners_page_', '').split('_');
        const page = parseInt(parts[0], 10);
        const filter = (parts[1] || 'all') as 'all' | 'online' | 'offline' | 'error';
        await sendMinersList(query.message.chat.id, page, filter, true, messageId);
      }
      // Miner selection (refresh = true for same miner)
      else if (data.startsWith('miner_')) {
        const minerName = data.replace('miner_', '');
        await sendMinerDetails(query.message.chat.id, minerName, true, messageId);
      } 
      // Reboot actions (2-step inline flow)
      else if (data.startsWith('reboot_request_')) {
        const minerName = data.replace('reboot_request_', '');
        // Step 1: Show confirmation UI (edit in place)
        const confirmMsg = `
⚠️ *Reboot Confirmation*

Are you sure you want to reboot *${minerName}*?

This will:
• Stop mining temporarily
• Restart the miner device
• Take 1-2 minutes to come back online
        `.trim();

        const keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Yes, Reboot', callback_data: `reboot_confirm_${minerName}` },
              { text: '❌ Cancel', callback_data: `reboot_cancel_${minerName}` },
            ],
          ],
        };

        await sendOrEditMessage(query.message.chat.id, confirmMsg, keyboard, 'miner_details', { minerName, confirm: true }, messageId, true);
      }
      else if (data.startsWith('reboot_confirm_')) {
        const minerName = data.replace('reboot_confirm_', '');
        // Step 2: Execute reboot (edit in place)
        await executeReboot(query.message.chat.id, minerName, messageId);
      } 
      else if (data.startsWith('reboot_cancel_')) {
        const minerName = data.replace('reboot_cancel_', '');
        // Cancel: go back to miner details (edit in place)
        await sendMinerDetails(query.message.chat.id, minerName, true, messageId);
      }
      // Pool actions
      else if (data.startsWith('pools_')) {
        const minerName = data.replace('pools_', '');
        await sendMinerPools(query.message.chat.id, minerName, true, messageId);
      }
      // Quick actions (refresh = true, use callback message ID)
      else if (data === 'action_status') {
        await sendFarmStatus(query.message.chat.id, true, messageId);
      }
      else if (data === 'action_miners') {
        await sendMinersList(query.message.chat.id, 0, 'all', true, messageId);
      }
      else if (data === 'action_alerts') {
        await sendActiveAlerts(query.message.chat.id, true, messageId);
      }
      else if (data === 'refresh_alerts') {
        // Refresh the consolidated alert message
        await updateConsolidatedAlertMessage();
      }
      else if (data === 'miners_list') {
        await sendMinersList(query.message.chat.id, 0, 'all');
      }
      // Help menu navigation
      else if (data === 'help_main') {
        await sendInteractiveHelp(query.message.chat.id);
      }
      else if (data.startsWith('help_')) {
        const category = data.replace('help_', '');
        await sendInteractiveHelp(query.message.chat.id, category);
      }
      // Main menu
      else if (data === 'main_menu') {
        await sendMainMenu(query.message.chat.id, true, messageId);
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
const sendFarmStatus = async (chatId: number, isRefresh: boolean = false, messageId?: number): Promise<void> => {
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

    await sendOrEditMessage(chatId, statusMessage, keyboard, 'status', undefined, messageId, isRefresh);
    logger.info('Telegram: Farm status sent successfully', { service: 'telegram', chatId });
  } catch (error) {
    logger.error('Telegram: Error sending farm status', { service: 'telegram', chatId, error });
    await bot?.sendMessage(chatId, '❌ Error fetching farm status');
  }
};

/**
 * Send list of all miners with pagination and filtering
 */
const sendMinersList = async (chatId: number, page: number = 0, filter: 'all' | 'online' | 'offline' | 'error' = 'all', isRefresh: boolean = false, messageId?: number): Promise<void> => {
  try {
    logger.info('Telegram: Sending miners list', { service: 'telegram', chatId, page, filter });
    // Get miners for this user only (owner-based filtering)
    const allMiners = getMiners(chatId.toString(), true);
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
      const emptyMessage = `⚠️ *No Miners Found*\n\n${filterText ? `No miners ${filterText}.` : 'No miners configured.'}\n\n💡 Try a different filter or check your miner configuration.`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Show All', callback_data: 'miners_page_0_all' },
            { text: '📊 Farm Status', callback_data: 'action_status' },
          ],
        ],
      };
      
      await sendOrEditMessage(chatId, emptyMessage, keyboard, 'miners', { page: 0, filter }, messageId, isRefresh);
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
    const offlineCount = stats.miners.filter(m => m.status === 'offline').length;
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

    await sendOrEditMessage(chatId, message, { inline_keyboard: minerButtons }, 'miners', { page: currentPage, filter }, messageId, isRefresh);
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
    const allMiners = getMiners(chatId.toString(), true);
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
      const emptyMessage = `🔍 *Search Results*\n\nNo miners found matching "${keyword}".\n\n💡 Try a different search term or browse all miners.`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '⛏️ View All Miners', callback_data: 'action_miners' },
            { text: '📊 Farm Status', callback_data: 'action_status' },
          ],
        ],
      };
      
      await sendOrEditMessage(chatId, emptyMessage, keyboard, 'miners', { search: keyword });
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

    await sendOrEditMessage(chatId, message, { inline_keyboard: minerButtons }, 'miners', { keyword });
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
const sendMinerDetails = async (chatId: number, minerName: string, isRefresh: boolean = false, messageId?: number): Promise<void> => {
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

    // Get smart back button based on navigation stack
    const context = getUserContext(chatId.toString());
    const backButton = context.navigationStack.length > 0 
      ? { text: `⬅️ Back to ${getViewName(context.currentView)}`, callback_data: 'nav_back' }
      : { text: '⬅️ Back to Miners', callback_data: 'miners_list' };

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔄 Reboot Miner', callback_data: `reboot_request_${minerName}` },
        ],
        [
          { text: '🌊 View Pools', callback_data: `pools_${minerName}` },
          { text: '🔄 Refresh Stats', callback_data: `miner_${minerName}` },
        ],
        [
          backButton,
        ],
      ],
    };

    await sendOrEditMessage(chatId, message, keyboard, 'miner_details', { minerName }, messageId, isRefresh);
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
 * Execute miner reboot (edit in place)
 */
const executeReboot = async (chatId: number, minerName: string, messageId?: number): Promise<void> => {
  try {
    logger.info('Telegram: Executing reboot', { service: 'telegram', chatId, minerName });
    
    // Step 1: Show "Rebooting..." (edit in place)
    const workingMsg = `🔄 *Rebooting ${minerName}...*\n\n⏳ Please wait, this may take 1-2 minutes.`;
    const workingKeyboard = {
      inline_keyboard: [
        [{ text: '⏳ Working...', callback_data: 'noop' }],
      ],
    };
    await sendOrEditMessage(chatId, workingMsg, workingKeyboard, 'miner_details', { minerName, rebooting: true }, messageId, true);
    
    // Step 2: Execute reboot
    const result = await rebootMiner(minerName);
    
    // Step 3: Show result with action buttons (edit in place)
    if (result.success) {
      const successMsg = `✅ *Reboot Successful*\n\n${result.message}\n\nThe miner should come back online in 1-2 minutes.`;
      const successKeyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Refresh Miner', callback_data: `miner_${minerName}` },
            { text: '⛏️ Miners', callback_data: 'action_miners' },
          ],
        ],
      };
      await sendOrEditMessage(chatId, successMsg, successKeyboard, 'miner_details', { minerName, rebooted: true }, messageId, true);
      logger.info('Telegram: Reboot successful', { service: 'telegram', chatId, minerName });
    } else {
      const failMsg = `❌ *Reboot Failed*\n\n${result.message}`;
      const failKeyboard = {
        inline_keyboard: [
          [{ text: '⬅️ Back to Miner', callback_data: `miner_${minerName}` }],
        ],
      };
      await sendOrEditMessage(chatId, failMsg, failKeyboard, 'miner_details', { minerName, rebootFailed: true }, messageId, true);
      logger.warn('Telegram: Reboot failed', { service: 'telegram', chatId, minerName, message: result.message });
    }
  } catch (error) {
    logger.error('Telegram: Error executing reboot', { service: 'telegram', chatId, minerName, error });
    const errorMsg = `❌ *Error Rebooting*\n\nFailed to reboot ${minerName}. Please try again or check the logs.`;
    const errorKeyboard = {
      inline_keyboard: [
        [{ text: '⬅️ Back to Miner', callback_data: `miner_${minerName}` }],
      ],
    };
    await sendOrEditMessage(chatId, errorMsg, errorKeyboard, 'miner_details', { minerName, rebootError: true }, messageId, true);
  }
};

/**
 * Send miner pool configuration
 */
const sendMinerPools = async (chatId: number, minerName: string, isRefresh: boolean = false, messageId?: number): Promise<void> => {
  try {
    logger.info('Telegram: Fetching pool configuration', { service: 'telegram', chatId, minerName });
    const miner = getMinerById(minerName);
    if (!miner) {
      await sendOrEditMessage(chatId, `❌ Miner "${minerName}" not found`, {
        inline_keyboard: [[{ text: '⬅️ Back to Miners', callback_data: 'miners_list' }]],
      }, 'pools', { minerName, error: true }, messageId, isRefresh);
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
      
      await sendOrEditMessage(chatId, errorMessage, keyboard, 'pools', { minerName, error: true }, messageId, isRefresh);
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

    await sendOrEditMessage(chatId, message, keyboard, 'pools', { minerName }, messageId, isRefresh);
    logger.info('Telegram: Pool configuration sent', { service: 'telegram', chatId, minerName, poolCount: result.pools!.length });
  } catch (error) {
    logger.error('Telegram: Error sending pool configuration', { service: 'telegram', chatId, minerName, error });
    const errorMsg = `❌ Error fetching pool configuration for "${minerName}"`;
    await sendOrEditMessage(chatId, errorMsg, {
      inline_keyboard: [[{ text: '⬅️ Back to Miner', callback_data: `miner_${minerName}` }]],
    }, 'pools', { minerName, error: true }, messageId, isRefresh);
  }
};

/**
 * Send active alerts
 */
const sendActiveAlerts = async (chatId: number, isRefresh: boolean = false, messageId?: number): Promise<void> => {
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

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Refresh', callback_data: 'action_alerts' },
            { text: '📊 Farm Status', callback_data: 'action_status' },
          ],
        ],
      };

      await sendOrEditMessage(chatId, message, keyboard, 'alerts', undefined, messageId, isRefresh);
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

    await sendOrEditMessage(chatId, message.trim(), keyboard, 'alerts', undefined, messageId, isRefresh);
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
  const activeBot = bot;
  if (!activeBot || !isEnabled) {
    logger.warn('Telegram bot not initialized or disabled', { service: 'telegram' });
    return;
  }

  try {
    await telegramApi.sendMessage(chatId, message, options, {
      description: 'sendMessageToChat',
      chatId,
    });
    logger.debug('Telegram: Message sent to chat', { service: 'telegram', chatId: chatId.substring(0, 4) + '***' });
  } catch (error) {
    logger.error('Telegram: Error sending message', { service: 'telegram', chatId, error });
  }
};

/**
 * Send consolidated alert notification to all authorized users
 * Updates a single message with all active alerts instead of creating new messages
 */
export const sendAlertNotification = async (alert: any): Promise<void> => {
  if (!bot || !isEnabled || authorizedChatIds.size === 0) {
    return;
  }

  // Create unique alert ID based on alert properties
  const alertId = `${alert.severity}_${alert.type}_${alert.miner || 'farm'}_${alert.timestamp}`;
  
  // Skip if already sent
  if (sentAlertIds.has(alertId)) {
    return;
  }

  // Mark as sent
  sentAlertIds.set(alertId, Date.now());
  trimSentAlerts();

  // Update consolidated alert message for all users
  await updateConsolidatedAlertMessage();
};

/**
 * Update consolidated alert message with all active alerts
 * This keeps a single message in the chat that shows all current alerts
 */
const updateConsolidatedAlertMessage = async (): Promise<void> => {
  const activeBot = bot;
  if (!activeBot || !isEnabled) return;

  // Get active alerts from alert service
  const { getActiveAlerts } = require('./alert.service');
  const activeAlerts = getActiveAlerts();

  // Group alerts by severity
  const criticalAlerts = activeAlerts.filter((a: any) => a.severity === 'critical');
  const warningAlerts = activeAlerts.filter((a: any) => a.severity === 'warning');
  const infoAlerts = activeAlerts.filter((a: any) => a.severity === 'info');

  // Build consolidated message
  let message = '';
  
  if (activeAlerts.length === 0) {
    message = '✅ *No Active Alerts*\n\nAll systems operating normally.';
  } else {
    message = `🔔 *Active Alerts (${activeAlerts.length})*\n\n`;
    
    if (criticalAlerts.length > 0) {
      message += `🚨 *CRITICAL (${criticalAlerts.length})*\n`;
      criticalAlerts.slice(0, 5).forEach((alert: any) => {
        const timeAgo = getTimeAgo(alert.timestamp);
        message += `  • ${alert.miner || 'Farm'}: ${alert.summary} _(${timeAgo})_\n`;
      });
      if (criticalAlerts.length > 5) {
        message += `  • _...and ${criticalAlerts.length - 5} more_\n`;
      }
      message += '\n';
    }
    
    if (warningAlerts.length > 0) {
      message += `⚠️  *WARNING (${warningAlerts.length})*\n`;
      warningAlerts.slice(0, 5).forEach((alert: any) => {
        const timeAgo = getTimeAgo(alert.timestamp);
        message += `  • ${alert.miner || 'Farm'}: ${alert.summary} _(${timeAgo})_\n`;
      });
      if (warningAlerts.length > 5) {
        message += `  • _...and ${warningAlerts.length - 5} more_\n`;
      }
      message += '\n';
    }
    
    if (infoAlerts.length > 0 && infoAlerts.length <= 3) {
      message += `ℹ️  *INFO (${infoAlerts.length})*\n`;
      infoAlerts.forEach((alert: any) => {
        const timeAgo = getTimeAgo(alert.timestamp);
        message += `  • ${alert.miner || 'Farm'}: ${alert.summary} _(${timeAgo})_\n`;
      });
    }
  }

  // Add action buttons
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'refresh_alerts' },
        { text: '🔔 View All', callback_data: 'action_alerts' },
      ],
      [
        { text: '📊 Farm Status', callback_data: 'action_status' },
      ],
    ],
  };

  // Update or create alert message for each chat
  for (const chatId of authorizedChatIds) {
    try {
      const chatIdNum = Number(chatId);
      if (Number.isNaN(chatIdNum)) continue;

      const entry = alertMessageIds.get(chatId);
      const existingMessageId = entry?.messageId;
      
      if (existingMessageId) {
        // Try to edit existing message
        try {
          await withTelegramRetry(() => activeBot.editMessageText(message, {
            chat_id: chatIdNum,
            message_id: existingMessageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          }), {
            description: 'alert message edit',
            chatId,
            messageId: existingMessageId,
          });
          alertMessageIds.set(chatId, { messageId: existingMessageId, updatedAt: Date.now() });
          logger.info('Telegram: Consolidated alert message updated', { 
            service: 'telegram', 
            chatId: chatId.substring(0, 4) + '***',
            alertCount: activeAlerts.length
          });
        } catch (editError: any) {
          // Message not found or too old, send new one
          const errMsg = (editError?.response?.body?.description || editError?.message || '').toLowerCase();
          if (errMsg.includes('message') && (errMsg.includes('not found') || errMsg.includes('too old'))) {
            const msg = await withTelegramRetry(() => activeBot.sendMessage(chatIdNum, message, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            }), {
              description: 'alert message replace after edit not found',
              chatId,
            });
            alertMessageIds.set(chatId, { messageId: msg.message_id, updatedAt: Date.now() });
            logger.info('Telegram: New consolidated alert message sent', { 
              service: 'telegram', 
              chatId: chatId.substring(0, 4) + '***'
            });
          }
        }
      } else {
        // No existing message, send new one
        const msg = await withTelegramRetry(() => activeBot.sendMessage(chatIdNum, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }), {
          description: 'alert message initial send',
          chatId,
        });
        alertMessageIds.set(chatId, { messageId: msg.message_id, updatedAt: Date.now() });
        logger.info('Telegram: Consolidated alert message created', { 
          service: 'telegram', 
          chatId: chatId.substring(0, 4) + '***',
          alertCount: activeAlerts.length
        });
      }
    } catch (error) {
      logger.error('Telegram: Error updating consolidated alert message', { 
        service: 'telegram', 
        chatId, 
        error 
      });
    }
  }
};

/**
 * Get human-readable time ago string
 */
const getTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 120) return '1m ago';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 7200) return '1h ago';
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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
 * Send alert notification (legacy function - now uses sendAlertNotification)
 */
export const sendAlert = async (alert: {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  miner?: string;
}): Promise<void> => {
  // Convert to new alert format and use sendAlertNotification
  await sendAlertNotification({
    severity: alert.severity,
    type: 'alert',
    summary: alert.title,
    details: alert.description,
    miner: alert.miner,
    timestamp: Date.now(),
  });
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
