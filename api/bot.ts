// 📦 Установка
// bun install grammy @supabase/supabase-js dotenv

import { createClient } from "@supabase/supabase-js"
import "dotenv/config"
import {
	Bot,
	InlineKeyboard,
	Keyboard,
	session,
	SessionFlavor,
	webhookCallback,
} from "grammy"

// 🌐 Supabase client
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)

interface SessionData {
	expectingBudget?: boolean
	addingExpense?: boolean
	expectingSaveGoal?: boolean
	confirmResetStep?: number
	editingExpenseId?: number
	editingExpenseStep?: number
}

type MyContext = Parameters<typeof bot.on>[0] & SessionFlavor<SessionData>

const bot = new Bot<MyContext>(process.env.BOT_TOKEN!)

bot.use(session<SessionData>({ initial: () => ({}) }))

function getCurrentMonth() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function daysLeftInMonth() {
	const now = new Date()
	const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
	return last.getDate() - now.getDate() + 1
}

async function getUserId(ctx: MyContext) {
	const tgId = ctx.from.id
	const { data: user } = await supabase
		.from("users")
		.select("id")
		.eq("telegram_id", tgId)
		.single()
	if (user) return user.id

	const { data: newUser } = await supabase
		.from("users")
		.insert({ telegram_id: tgId })
		.select()
		.single()

	return newUser.id
}

function parseExpenseLine(line: string) {
	const trimmed = line.trim()
	const fullMatch = trimmed.match(/(.+?)[-,]\s*(.*?)\s+(\d+)$/)
	if (fullMatch) {
		const [_, category, comment, amount] = fullMatch
		return {
			category: category.trim(),
			comment: comment.trim() || null,
			amount: parseInt(amount),
		}
	}
	const simpleMatch = trimmed.match(/(.+)\s+(\d+)$/)
	if (simpleMatch) {
		const [_, category, amount] = simpleMatch
		return { category: category.trim(), comment: null, amount: parseInt(amount) }
	}
	return null
}

const emojiMap: Record<string, string> = {
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
}

function getEmoji(category: string) {
	const lower = category.toLowerCase()
	return emojiMap[lower] || "💸"
}

const defaultMenu = new Keyboard()
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
	.resized()

bot.command("start", async ctx => {
	await ctx.reply("👋 Привет! Выбери действие:", { reply_markup: defaultMenu })
})

bot.hears("✅ Новый месяц", async ctx => {
	ctx.session.expectingBudget = true
	await ctx.reply("💰 Введи бюджет на месяц (в тенге):")
})

bot.hears("➕ Добавить расход", async ctx => {
	ctx.session.addingExpense = true
	await ctx.reply("✏️ Введи расход(ы):\nПример:\nкомпы - ночь 4000неда, ресторан 12000")
})

bot.hears("🗑️ Удалить расход", async ctx => {
	const userId = await getUserId(ctx)
	const month = getCurrentMonth()

	const { data: expenses, error } = await supabase
		.from("expenses")
		.select("id, category, amount, comment")
		.eq("user_id", userId)
		.gte("created_at", `${month}-01`)
		.order("created_at", { ascending: false })
		.limit(5)

	if (error) {
		console.error("❌ Ошибка при загрузке расходов:", error)
		return ctx.reply("❌ Не удалось загрузить расходы.")
	}

	if (!expenses || expenses.length === 0) {
		return ctx.reply("📭 Нет расходов для удаления.")
	}

	for (const e of expenses) {
		const label = `${getEmoji(e.category)} ${e.category} — ${e.amount}₸${
			e.comment ? ` (${e.comment})` : ""
		}`

		const keyboard = new InlineKeyboard().text(
			`❌ Удалить`,
			`delete_${e.id}`, // UUID как строка
		)

		await ctx.reply(`🧾 ${label}`, { reply_markup: keyboard })
	}
})

// Удаление расхода по нажатию кнопки
bot.callbackQuery(/^delete_(.+)$/, async ctx => {
	try {
		const id = ctx.match![1] // UUID строкой

		if (!id || id.length < 10) throw new Error("Неверный UUID")

		const { error } = await supabase.from("expenses").delete().eq("id", id)

		if (error) {
			console.error("❌ Supabase ошибка:", error)
			await ctx.answerCallbackQuery({ text: "❌ Ошибка при удалении", show_alert: true })
			return
		}

		await ctx.editMessageText("🗑️ Расход удалён.")
		await ctx.answerCallbackQuery({ text: "✅ Удалено", show_alert: false })
	} catch (err) {
		console.error("❌ Ошибка в callbackQuery:", err)
		await ctx.answerCallbackQuery({ text: "❌ Не удалось удалить", show_alert: true })
	}
})

bot.hears("📊 Посчитать расходы", async ctx => {
	const userId = await getUserId(ctx)
	const month = getCurrentMonth()
	const { data: budgetRow } = await supabase
		.from("months")
		.select("budget")
		.eq("user_id", userId)
		.eq("month", month)
		.single()
	const { data: expenses } = await supabase
		.from("expenses")
		.select("amount, category")
		.eq("user_id", userId)
		.gte("created_at", `${month}-01`)
	const spent = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0
	const budget = budgetRow?.budget ?? 0
	const grouped = expenses?.reduce((acc, e) => {
		acc[e.category] = (acc[e.category] || 0) + e.amount
		return acc
	}, {} as Record<string, number>)
	const list = grouped
		? Object.entries(grouped)
				.map(([cat, amt]) => `• ${getEmoji(cat)} ${cat} — ${amt} ₸`)
				.join("\n")
		: "Нет расходов"
	ctx.reply(
		`💸 Потрачено: ${spent} ₸\n📊 Остаток: ${budget - spent} ₸\n\n🧾 Расходы:\n${list}`,
	)
})

bot.hears("📈 Тренды по категориям", async ctx => {
	const userId = await getUserId(ctx)
	const { data: expenses } = await supabase
		.from("expenses")
		.select("category, amount")
		.eq("user_id", userId)
	if (!expenses || expenses.length === 0) return ctx.reply("Нет данных.")
	const grouped = expenses.reduce((acc, e) => {
		acc[e.category] = (acc[e.category] || 0) + e.amount
		return acc
	}, {} as Record<string, number>)
	const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1])
	const top = sorted
		.map(([cat, amt]) => `• ${getEmoji(cat)} ${cat} — ${amt} ₸`)
		.join("\n")
	ctx.reply(`📊 Топ расходов:\n${top}`)
})

bot.hears("📅 Месяцы", async ctx => {
	const userId = await getUserId(ctx)

	// Получаем список месяцев пользователя с бюджетами
	const { data: months, error: monthsError } = await supabase
		.from("months")
		.select("month, budget")
		.eq("user_id", userId)
		.order("month", { ascending: false })

	if (monthsError) {
		console.error("❌ Ошибка при загрузке месяцев:", monthsError)
		return ctx.reply("❌ Не удалось получить данные.")
	}

	if (!months || months.length === 0) {
		return ctx.reply("📭 Нет сохранённых месяцев.")
	}

	// Загружаем ВСЕ расходы пользователя
	const { data: expenses, error: expensesError } = await supabase
		.from("expenses")
		.select("amount, created_at")
		.eq("user_id", userId)

	if (expensesError) {
		console.error("❌ Ошибка при загрузке расходов:", expensesError)
		return ctx.reply("❌ Не удалось загрузить расходы.")
	}

	// Группируем и отображаем
	const result = months.map(({ month, budget }) => {
		const monthStart = `${month}-01`
		const monthEnd = `${month}-31`

		// Считаем сколько потрачено за этот месяц
		const spent = expenses
			.filter(e => e.created_at >= monthStart && e.created_at <= monthEnd)
			.reduce((sum, e) => sum + e.amount, 0)

		const left = budget - spent

		return `📅 ${month}\n💰 Бюджет: ${budget} ₸\n💸 Потрачено: ${spent} ₸\n💵 Остаток: ${left} ₸`
	})

	await ctx.reply(result.join("\n\n"))
})

bot.hears("💡 Советы по экономии", async ctx => {
	ctx.session.expectingSaveGoal = true
	ctx.reply("💾 Сколько ты хочешь сохранить в этом месяце? (в тенге)")
})

bot.hears("❌ Сбросить месяц", async ctx => {
	ctx.session.confirmResetStep = 1
	ctx.reply("⚠️ Ты точно хочешь сбросить текущий месяц? Напиши `Да`, если уверен.")
})

bot.on("message:text", async ctx => {
	const text = ctx.message.text
	const userId = await getUserId(ctx)
	const month = getCurrentMonth()

	if (ctx.session.confirmResetStep === 1 && text.toLowerCase() === "да") {
		ctx.session.confirmResetStep = 2
		return ctx.reply(
			"🛑 Подтверди ещё раз: сбросить все данные за месяц? Напиши `Да` повторно.",
		)
	}
	if (ctx.session.confirmResetStep === 2 && text.toLowerCase() === "да") {
		await supabase
			.from("expenses")
			.delete()
			.eq("user_id", userId)
			.gte("created_at", `${month}-01`)
		await supabase.from("months").delete().eq("user_id", userId).eq("month", month)
		ctx.session.confirmResetStep = undefined
		await ctx.reply("✅ Месяц сброшен.\n\n🧭 Начни заново: нажми `Новый месяц`", {
			reply_markup: new Keyboard().text("Новый месяц").resized(),
		})
		return
	}

	if (ctx.session.expectingBudget) {
		const budget = parseInt(text)
		if (isNaN(budget)) return ctx.reply("Введите число")
		await supabase
			.from("months")
			.upsert({ user_id: userId, month, budget, created_at: new Date() })
		ctx.session.expectingBudget = false
		return ctx.reply(`✅ Установлен бюджет на ${month}: ${budget} ₸`, {
			reply_markup: defaultMenu,
		})
	}

	if (ctx.session.addingExpense) {
		const lines = text.split("\n")
		const expenses = lines.map(parseExpenseLine).filter(Boolean)
		if (expenses.length === 0) return ctx.reply("Не удалось распознать расходы")
		await Promise.all(
			expenses.map(e =>
				supabase.from("expenses").insert({
					user_id: userId,
					amount: e.amount,
					category: e.category,
					comment: e.comment,
					created_at: new Date(),
				}),
			),
		)
		ctx.session.addingExpense = false
		return ctx.reply(
			`✅ Добавлено:\n` +
				expenses
					.map(
						e =>
							`• ${getEmoji(e.category)} ${e.category} — ${e.amount} ₸${
								e.comment ? ` (${e.comment})` : ""
							}`,
					)
					.join("\n"),
			{ reply_markup: defaultMenu },
		)
	}

	if (ctx.session.editingExpenseId) {
		const parsed = parseExpenseLine(text)
		if (!parsed) return ctx.reply("Не удалось распознать строку для редактирования")
		await supabase
			.from("expenses")
			.update({
				amount: parsed.amount,
				category: parsed.category,
				comment: parsed.comment,
			})
			.eq("id", ctx.session.editingExpenseId)
		ctx.session.editingExpenseId = undefined
		return ctx.reply("✅ Расход обновлён", { reply_markup: defaultMenu })
	}

	if (ctx.session.expectingSaveGoal) {
		const goal = parseInt(text)
		if (isNaN(goal)) return ctx.reply("Введите корректную сумму")
		const { data: budgetRow } = await supabase
			.from("months")
			.select("budget")
			.eq("user_id", userId)
			.eq("month", month)
			.single()
		const { data: expenses } = await supabase
			.from("expenses")
			.select("amount")
			.eq("user_id", userId)
			.gte("created_at", `${month}-01`)
		const spent = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0
		const budget = budgetRow?.budget ?? 0
		const left = budget - spent
		const days = daysLeftInMonth()
		const perDay = Math.floor((left - goal) / days)
		ctx.session.expectingSaveGoal = false
		if (left >= goal) {
			return ctx.reply(
				`📊 Чтобы сохранить ${goal} ₸:\n\n• Осталось дней: ${days}\n• Лимит на день: ${perDay} ₸\n\n🔥 Ты справишься!`,
			)
		} else {
			const needToCut = goal - left
			return ctx.reply(
				`⚠️ Чтобы сохранить ${goal} ₸, нужно сократить расходы на ${needToCut} ₸.\n\nСейчас уже не хватает средств для этой цели.`,
			)
		}
	}
})

bot.catch(err => {
	console.error("❌ Глобальная ошибка:", err)
})

// bot.start()
export default webhookCallback(bot, "https")
