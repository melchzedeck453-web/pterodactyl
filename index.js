require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

// ========== Simple JSON Database ==========
const DB_PATH = path.join(__dirname, 'db.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('DB load error:', e.message);
  }
  return { users: {}, servers: [] };
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

let db = loadDB();

// ========== Helpers ==========
function isAdmin(ctx) {
  return ctx.from.id === ADMIN_ID;
}

function getUser(ctx) {
  const id = String(ctx.from.id);
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username: ctx.from.username || ctx.from.first_name || 'User',
      createdAt: new Date().toISOString()
    };
    saveDB(db);
  }
  return db.users[id];
}

const EGGS = {
  nodejs: { name: 'Node.js', icon: '🟢' },
  python: { name: 'Python', icon: '🐍' },
  minecraft: { name: 'Minecraft Paper', icon: '⛏️' }
};

const PLANS = [
  { ram: 2, name: '2 GB' },
  { ram: 4, name: '4 GB' },
  { ram: 8, name: '8 GB' },
  { ram: 16, name: '16 GB' },
  { ram: 32, name: '32 GB' }
];

const userState = {};

// ========== Start ==========
bot.start(async (ctx) => {
  const user = getUser(ctx);

  const text = `🪺 *Nestly Free Bot*

Welcome ${user.username}!

Everything is completely free and unlimited.
No coins. No restrictions.

Use the buttons below:`;

  await ctx.replyWithMarkdown(text, Markup.keyboard([
    ['📦 My Servers', '➕ Create Server'],
    ...(isAdmin(ctx) ? [['👑 Admin Panel']] : [])
  ]).resize());
});

// ========== Create Server ==========
bot.hears(['➕ Create Server', '/create'], async (ctx) => {
  userState[ctx.from.id] = { step: 'egg' };
  await ctx.reply('Choose what to deploy:', Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Node.js', 'egg_nodejs')],
    [Markup.button.callback('🐍 Python', 'egg_python')],
    [Markup.button.callback('⛏️ Minecraft Paper', 'egg_minecraft')]
  ]));
});

bot.action(/egg_(.+)/, async (ctx) => {
  const egg = ctx.match[1];
  userState[ctx.from.id] = { 
    ...(userState[ctx.from.id] || {}),
    step: 'plan', 
    egg 
  };
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Selected: ${EGGS[egg].icon} ${EGGS[egg].name}\n\nChoose RAM (all free):`,
    Markup.inlineKeyboard(
      PLANS.map(p => [Markup.button.callback(`${p.name} RAM`, `plan_${p.ram}`)])
    )
  );
});

bot.action(/plan_(\d+)/, async (ctx) => {
  const ram = Number(ctx.match[1]);
  const state = userState[ctx.from.id];
  if (!state) return;

  state.ram = ram;
  state.step = 'name';
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Selected: ${ram} GB RAM\n\nNow send me the *name* of the server:`,
    { parse_mode: 'Markdown' }
  );
});

// Handle server name
bot.on('text', async (ctx) => {
  const state = userState[ctx.from.id];
  if (!state || state.step !== 'name') return;

  const name = ctx.message.text.trim();
  if (name.length < 2 || name.length > 32) {
    return ctx.reply('Name must be between 2-32 characters. Try again:');
  }

  const ownerId = state.targetOwner || String(ctx.from.id);

  const server = {
    id: uuidv4().slice(0, 8),
    ownerId,
    name,
    egg: state.egg,
    ram: state.ram,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: state.targetOwner ? 'admin' : 'user'
  };

  db.servers.push(server);
  saveDB(db);
  delete userState[ctx.from.id];

  const eggInfo = EGGS[server.egg];
  await ctx.replyWithMarkdown(
    `✅ *Server created successfully!*\n\n` +
    `*Name:* ${server.name}\n` +
    `*Type:* ${eggInfo.icon} ${eggInfo.name}\n` +
    `*RAM:* ${server.ram} GB\n` +
    `*ID:* \`${server.id}\`\n` +
    `*Status:* Active\n\n` +
    `Everything is free — create as many as you want!`
  );
});

// ========== My Servers ==========
bot.hears(['📦 My Servers', '/myservers'], async (ctx) => {
  const myServers = db.servers.filter(s => s.ownerId === String(ctx.from.id));

  if (myServers.length === 0) {
    return ctx.reply('You have no servers yet.\nPress ➕ Create Server to make one (completely free).');
  }

  let text = `📦 *Your Servers* (${myServers.length})\n\n`;
  myServers.forEach(s => {
    const egg = EGGS[s.egg];
    text += `${egg.icon} *${s.name}*\n` +
            `   ${s.ram}GB • ID: \`${s.id}\` • ${s.status}\n\n`;
  });

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(
    myServers.map(s => [
      Markup.button.callback(`🗑 Delete ${s.name}`, `delete_${s.id}`)
    ])
  ));
});

bot.action(/delete_(.+)/, async (ctx) => {
  const id = ctx.match[1];
  const server = db.servers.find(s => s.id === id);
  if (!server) return ctx.answerCbQuery('Server not found');

  if (server.ownerId !== String(ctx.from.id) && !isAdmin(ctx)) {
    return ctx.answerCbQuery('You can only delete your own servers');
  }

  db.servers = db.servers.filter(s => s.id !== id);
  saveDB(db);
  await ctx.answerCbQuery('Server deleted');
  await ctx.editMessageText(`🗑 Server *${server.name}* has been deleted.`, { parse_mode: 'Markdown' });
});

// ========== ADMIN PANEL ==========
bot.hears(['👑 Admin Panel', '/admin'], async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin only.');

  const totalUsers = Object.keys(db.users).length;
  const totalServers = db.servers.length;

  await ctx.replyWithMarkdown(
    `👑 *Admin Panel*\n\n` +
    `👥 Users: ${totalUsers}\n` +
    `🖥️ Servers: ${totalServers}\n\n` +
    `Commands:\n` +
    `/createfor <user_id> - Create server for any user\n` +
    `/broadcast <message> - Message all users`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 All Servers', 'admin_allservers')],
      [Markup.button.callback('👤 All Users', 'admin_users')]
    ])
  );
});

bot.action('admin_allservers', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCbQuery();

  if (db.servers.length === 0) {
    return ctx.reply('No servers exist yet.');
  }

  let text = `🖥️ *All Servers* (${db.servers.length})\n\n`;
  db.servers.forEach(s => {
    const egg = EGGS[s.egg];
    const owner = db.users[s.ownerId]?.username || s.ownerId;
    text += `${egg.icon} *${s.name}* (${s.ram}GB)\n` +
            `   Owner: ${owner} | ID: \`${s.id}\`\n\n`;
  });
  await ctx.replyWithMarkdown(text);
});

bot.action('admin_users', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCbQuery();

  let text = `👥 *Users*\n\n`;
  Object.values(db.users).forEach(u => {
    const count = db.servers.filter(s => s.ownerId === u.id).length;
    text += `• ${u.username} (\`${u.id}\`) — ${count} servers\n`;
  });
  await ctx.replyWithMarkdown(text);
});

// Admin create for another user
bot.command('createfor', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Admin only.');

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Usage: /createfor <telegram_user_id>');
  }

  const targetId = args[1];
  userState[ctx.from.id] = { step: 'egg', targetOwner: targetId };

  await ctx.reply(`Creating server for user \`${targetId}\`\n\nChoose egg:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🟢 Node.js', 'egg_nodejs')],
      [Markup.button.callback('🐍 Python', 'egg_python')],
      [Markup.button.callback('⛏️ Minecraft', 'egg_minecraft')]
    ])
  });
});

// Broadcast
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const msg = ctx.message.text.replace('/broadcast', '').trim();
  if (!msg) return ctx.reply('Usage: /broadcast your message here');

  let count = 0;
  for (const uid of Object.keys(db.users)) {
    try {
      await bot.telegram.sendMessage(uid, `📢 *Admin Message*\n\n${msg}`, { parse_mode: 'Markdown' });
      count++;
    } catch (e) {}
  }
  await ctx.reply(`Broadcast sent to ${count} users.`);
});

// ========== Launch ==========
bot.launch().then(() => {
  console.log('🪺 Nestly Free Telegram Bot is running!');
  console.log(`Admin ID: ${ADMIN_ID}`);
}).catch(err => {
  console.error('Failed to start bot:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
