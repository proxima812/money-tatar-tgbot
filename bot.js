"use strict";
// 📦 Установка
// bun install grammy @supabase/supabase-js dotenv
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
require("dotenv/config");
const grammy_1 = require("grammy");
// 🌐 Supabase client
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new grammy_1.Bot(process.env.BOT_TOKEN);
bot.use((0, grammy_1.session)({ initial: () => ({}) }));
function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function daysLeftInMonth() {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return last.getDate() - now.getDate() + 1;
}
function getUserId(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        const tgId = ctx.from.id;
        const { data: user } = yield supabase
            .from("users")
            .select("id")
            .eq("telegram_id", tgId)
            .single();
        if (user)
            return user.id;
        const { data: newUser } = yield supabase
            .from("users")
            .insert({ telegram_id: tgId })
            .select()
            .single();
        return newUser.id;
    });
}
function parseExpenseLine(line) {
    const trimmed = line.trim();
    const fullMatch = trimmed.match(/(.+?)[-,]\s*(.*?)\s+(\d+)$/);
    if (fullMatch) {
        const [_, category, comment, amount] = fullMatch;
        return {
            category: category.trim(),
            comment: comment.trim() || null,
            amount: parseInt(amount),
        };
    }
    const simpleMatch = trimmed.match(/(.+)\s+(\d+)$/);
    if (simpleMatch) {
        const [_, category, amount] = simpleMatch;
        return { category: category.trim(), comment: null, amount: parseInt(amount) };
    }
    return null;
}
const emojiMap = {
    еда: "🍔",
    ресторан: "🍽️",
    компы: "💻",
    грибы: "🍄",
    такси: "🚕",
    транспорт: "🚌",
    одежда: "👕",
    здоровье: "💊",
    кофе: "☕",
    развлечения: "🎮",
    книги: "📚",
    аренда: "🏠",
    услуги: "🛠️",
    путешествия: "✈️",
    связь: "📱",
    подарки: "🎁",
    дети: "🧒",
    животные: "🐶",
};
function getEmoji(category) {
    const lower = category.toLowerCase();
    return emojiMap[lower] || "💸";
}
const defaultMenu = new grammy_1.Keyboard()
    .text("✅ Новый месяц")
    .text("📅 Месяцы")
    .row()
    .text("➕ Добавить расход")
    .text("🗑️ Удалить расход") // Заменено здесь
    .row()
    .text("📊 Посчитать расходы")
    .text("📈 Тренды по категориям")
    .row()
    .text("💡 Советы по экономии")
    .text("❌ Сбросить месяц")
    .resized();
bot.command("start", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply("👋 Привет! Выбери действие:", { reply_markup: defaultMenu });
}));
bot.hears("✅ Новый месяц", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    ctx.session.expectingBudget = true;
    yield ctx.reply("💰 Введи бюджет на месяц (в тенге):");
}));
bot.hears("➕ Добавить расход", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    ctx.session.addingExpense = true;
    yield ctx.reply("✏️ Введи расход(ы):\nПример:\nкомпы - ночь 4000неда, ресторан 12000");
}));
bot.hears("🗑️ Удалить расход", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = yield getUserId(ctx);
    const month = getCurrentMonth();
    const { data: expenses, error } = yield supabase
        .from("expenses")
        .select("id, category, amount, comment")
        .eq("user_id", userId)
        .gte("created_at", `${month}-01`)
        .order("created_at", { ascending: false })
        .limit(5);
    if (error) {
        console.error("❌ Ошибка при загрузке расходов:", error);
        return ctx.reply("❌ Не удалось загрузить расходы.");
    }
    if (!expenses || expenses.length === 0) {
        return ctx.reply("📭 Нет расходов для удаления.");
    }
    for (const e of expenses) {
        const label = `${getEmoji(e.category)} ${e.category} — ${e.amount}₸${e.comment ? ` (${e.comment})` : ""}`;
        const keyboard = new grammy_1.InlineKeyboard().text(`❌ Удалить`, `delete_${e.id}`);
        yield ctx.reply(`🧾 ${label}`, { reply_markup: keyboard });
    }
}));
// Удаление расхода по нажатию кнопки
bot.callbackQuery(/^delete_(.+)$/, (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = ctx.match[1]; // UUID строкой
        if (!id || id.length < 10)
            throw new Error("Неверный UUID");
        const { error } = yield supabase.from("expenses").delete().eq("id", id);
        if (error) {
            console.error("❌ Supabase ошибка:", error);
            yield ctx.answerCallbackQuery({ text: "❌ Ошибка при удалении", show_alert: true });
            return;
        }
        yield ctx.editMessageText("🗑️ Расход удалён.");
        yield ctx.answerCallbackQuery({ text: "✅ Удалено", show_alert: false });
    }
    catch (err) {
        console.error("❌ Ошибка в callbackQuery:", err);
        yield ctx.answerCallbackQuery({ text: "❌ Не удалось удалить", show_alert: true });
    }
}));
bot.hears("📊 Посчитать расходы", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const userId = yield getUserId(ctx);
    const month = getCurrentMonth();
    const { data: budgetRow } = yield supabase
        .from("months")
        .select("budget")
        .eq("user_id", userId)
        .eq("month", month)
        .single();
    const { data: expenses } = yield supabase
        .from("expenses")
        .select("amount, category")
        .eq("user_id", userId)
        .gte("created_at", `${month}-01`);
    const spent = (_a = expenses === null || expenses === void 0 ? void 0 : expenses.reduce((sum, e) => sum + e.amount, 0)) !== null && _a !== void 0 ? _a : 0;
    const budget = (_b = budgetRow === null || budgetRow === void 0 ? void 0 : budgetRow.budget) !== null && _b !== void 0 ? _b : 0;
    const grouped = expenses === null || expenses === void 0 ? void 0 : expenses.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount;
        return acc;
    }, {});
    const list = grouped
        ? Object.entries(grouped)
            .map(([cat, amt]) => `• ${getEmoji(cat)} ${cat} — ${amt} ₸`)
            .join("\n")
        : "Нет расходов";
    ctx.reply(`💸 Потрачено: ${spent} ₸\n📊 Остаток: ${budget - spent} ₸\n\n🧾 Расходы:\n${list}`);
}));
bot.hears("📈 Тренды по категориям", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = yield getUserId(ctx);
    const { data: expenses } = yield supabase
        .from("expenses")
        .select("category, amount")
        .eq("user_id", userId);
    if (!expenses || expenses.length === 0)
        return ctx.reply("Нет данных.");
    const grouped = expenses.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount;
        return acc;
    }, {});
    const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    const top = sorted
        .map(([cat, amt]) => `• ${getEmoji(cat)} ${cat} — ${amt} ₸`)
        .join("\n");
    ctx.reply(`📊 Топ расходов:\n${top}`);
}));
bot.hears("📅 Месяцы", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = yield getUserId(ctx);
    // Получаем список месяцев пользователя с бюджетами
    const { data: months, error: monthsError } = yield supabase
        .from("months")
        .select("month, budget")
        .eq("user_id", userId)
        .order("month", { ascending: false });
    if (monthsError) {
        console.error("❌ Ошибка при загрузке месяцев:", monthsError);
        return ctx.reply("❌ Не удалось получить данные.");
    }
    if (!months || months.length === 0) {
        return ctx.reply("📭 Нет сохранённых месяцев.");
    }
    // Загружаем ВСЕ расходы пользователя
    const { data: expenses, error: expensesError } = yield supabase
        .from("expenses")
        .select("amount, created_at")
        .eq("user_id", userId);
    if (expensesError) {
        console.error("❌ Ошибка при загрузке расходов:", expensesError);
        return ctx.reply("❌ Не удалось загрузить расходы.");
    }
    // Группируем и отображаем
    const result = months.map(({ month, budget }) => {
        const monthStart = `${month}-01`;
        const monthEnd = `${month}-31`;
        // Считаем сколько потрачено за этот месяц
        const spent = expenses
            .filter(e => e.created_at >= monthStart && e.created_at <= monthEnd)
            .reduce((sum, e) => sum + e.amount, 0);
        const left = budget - spent;
        return `📅 ${month}\n💰 Бюджет: ${budget} ₸\n💸 Потрачено: ${spent} ₸\n💵 Остаток: ${left} ₸`;
    });
    yield ctx.reply(result.join("\n\n"));
}));
bot.hears("💡 Советы по экономии", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    ctx.session.expectingSaveGoal = true;
    ctx.reply("💾 Сколько ты хочешь сохранить в этом месяце? (в тенге)");
}));
bot.hears("❌ Сбросить месяц", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    ctx.session.confirmResetStep = 1;
    ctx.reply("⚠️ Ты точно хочешь сбросить текущий месяц? Напиши `Да`, если уверен.");
}));
bot.on("message:text", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const text = ctx.message.text;
    const userId = yield getUserId(ctx);
    const month = getCurrentMonth();
    if (ctx.session.confirmResetStep === 1 && text.toLowerCase() === "да") {
        ctx.session.confirmResetStep = 2;
        return ctx.reply("🛑 Подтверди ещё раз: сбросить все данные за месяц? Напиши `Да` повторно.");
    }
    if (ctx.session.confirmResetStep === 2 && text.toLowerCase() === "да") {
        yield supabase
            .from("expenses")
            .delete()
            .eq("user_id", userId)
            .gte("created_at", `${month}-01`);
        yield supabase.from("months").delete().eq("user_id", userId).eq("month", month);
        ctx.session.confirmResetStep = undefined;
        yield ctx.reply("✅ Месяц сброшен.\n\n🧭 Начни заново: нажми `Новый месяц`", {
            reply_markup: new grammy_1.Keyboard().text("Новый месяц").resized(),
        });
        return;
    }
    if (ctx.session.expectingBudget) {
        const budget = parseInt(text);
        if (isNaN(budget))
            return ctx.reply("Введите число");
        yield supabase
            .from("months")
            .upsert({ user_id: userId, month, budget, created_at: new Date() });
        ctx.session.expectingBudget = false;
        return ctx.reply(`✅ Установлен бюджет на ${month}: ${budget} ₸`, {
            reply_markup: defaultMenu,
        });
    }
    if (ctx.session.addingExpense) {
        const lines = text.split("\n");
        const expenses = lines.map(parseExpenseLine).filter(Boolean);
        if (expenses.length === 0)
            return ctx.reply("Не удалось распознать расходы");
        yield Promise.all(expenses.map(e => supabase.from("expenses").insert({
            user_id: userId,
            amount: e.amount,
            category: e.category,
            comment: e.comment,
            created_at: new Date(),
        })));
        ctx.session.addingExpense = false;
        return ctx.reply(`✅ Добавлено:\n` +
            expenses
                .map(e => `• ${getEmoji(e.category)} ${e.category} — ${e.amount} ₸${e.comment ? ` (${e.comment})` : ""}`)
                .join("\n"), { reply_markup: defaultMenu });
    }
    if (ctx.session.editingExpenseId) {
        const parsed = parseExpenseLine(text);
        if (!parsed)
            return ctx.reply("Не удалось распознать строку для редактирования");
        yield supabase
            .from("expenses")
            .update({
            amount: parsed.amount,
            category: parsed.category,
            comment: parsed.comment,
        })
            .eq("id", ctx.session.editingExpenseId);
        ctx.session.editingExpenseId = undefined;
        return ctx.reply("✅ Расход обновлён", { reply_markup: defaultMenu });
    }
    if (ctx.session.expectingSaveGoal) {
        const goal = parseInt(text);
        if (isNaN(goal))
            return ctx.reply("Введите корректную сумму");
        const { data: budgetRow } = yield supabase
            .from("months")
            .select("budget")
            .eq("user_id", userId)
            .eq("month", month)
            .single();
        const { data: expenses } = yield supabase
            .from("expenses")
            .select("amount")
            .eq("user_id", userId)
            .gte("created_at", `${month}-01`);
        const spent = (_a = expenses === null || expenses === void 0 ? void 0 : expenses.reduce((sum, e) => sum + e.amount, 0)) !== null && _a !== void 0 ? _a : 0;
        const budget = (_b = budgetRow === null || budgetRow === void 0 ? void 0 : budgetRow.budget) !== null && _b !== void 0 ? _b : 0;
        const left = budget - spent;
        const days = daysLeftInMonth();
        const perDay = Math.floor((left - goal) / days);
        ctx.session.expectingSaveGoal = false;
        if (left >= goal) {
            return ctx.reply(`📊 Чтобы сохранить ${goal} ₸:\n\n• Осталось дней: ${days}\n• Лимит на день: ${perDay} ₸\n\n🔥 Ты справишься!`);
        }
        else {
            const needToCut = goal - left;
            return ctx.reply(`⚠️ Чтобы сохранить ${goal} ₸, нужно сократить расходы на ${needToCut} ₸.\n\nСейчас уже не хватает средств для этой цели.`);
        }
    }
}));
bot.catch(err => {
    console.error("❌ Глобальная ошибка:", err);
});
bot.start();
