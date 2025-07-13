import { createClient } from "@supabase/supabase-js"
import "dotenv/config"
import { Bot, InlineKeyboard, Keyboard, session, SessionFlavor } from "grammy"

// 🌐 Supabase client
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)

interface SessionData {
	expectingBudget?: boolean
	addingExpense?: boolean
	expectingSaveGoal?: boolean
	confirmResetStep?: number
	expectingFoodSubcategory?: boolean
	pendingExpense?: { category: string; comment: string | null; amount: number }
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
	try {
		const tgId = ctx.from.id
		const { data: user, error: selectError } = await supabase
			.from("users")
			.select("id")
			.eq("telegram_id", tgId)
			.single()
		if (selectError) throw selectError
		if (user) return user.id

		const { data: newUser, error: insertError } = await supabase
			.from("users")
			.insert({ telegram_id: tgId })
			.select()
			.single()
		if (insertError) throw insertError
		return newUser.id
	} catch (error) {
		console.error("❌ Ошибка в getUserId:", error)
		await ctx.reply("❌ Ошибка сервера. Попробуйте позже.")
		throw error
	}
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
	.text("🗑️ Удалить расход")
	.row()
	.text("📊 Посчитать расходы")
	.text("📈 Тренды по категориям")
	.row()
	.text("💡 Советы по экономии")
	.text("❌ Сбросить месяц")
	.row()
	.text("Отмена")
	.resized()

const foodSubcategoryKeyboard = new InlineKeyboard()
	.text("Яндекс", "food_yandex")
	.text("Small", "food_small")
	.text("Продуктовый", "food_grocery")
	.row()
	.text("Отмена", "food_cancel")

bot.command("start", async ctx => {
	await ctx.reply("👋 Привет! Выбери действие:", { reply_markup: defaultMenu })
})

bot.hears("Отмена", async ctx => {
	ctx.session.expectingBudget = false
	ctx.session.addingExpense = false
	ctx.session.expectingSaveGoal = false
	ctx.session.confirmResetStep = undefined
	ctx.session.expectingFoodSubcategory = false
	ctx.session.pendingExpense = undefined
	await ctx.reply("🚫 Действие отменено.", { reply_markup: defaultMenu })
})

bot.hears("✅ Новый месяц", async ctx => {
	ctx.session.expectingBudget = true
	await ctx.reply(
		"💰 Введи бюджет на месяц (в тенге, положительное число до 1,000,000,000):",
		{
			reply_markup: new Keyboard().text("Отмена").resized(),
		},
	)
})

bot.hears("➕ Добавить расход", async ctx => {
	ctx.session.addingExpense = true
	await ctx.reply(
		"✏️ Введи расход(ы):\nПример:\nтатарка 50000\nили\nтатарка - ужин 50000\n\n‼ По очереди расходы добавлять. (По одному)",
		{ reply_markup: new Keyboard().text("Отмена").resized() },
	)
})

bot.hears("🗑️ Удалить расход", async ctx => {
	const userId = await getUserId(ctx)
	const month = getCurrentMonth()

	const { data: expenses, error } = await supabase
		.from("expenses")
		.select("id, category, amount, comment, subcategory")
		.eq("user_id", userId)
		.gte("created_at", `${month}-01`)
		.order("created_at", { ascending: false })
		.limit(5)

	if (error) {
		console.error("❌ Ошибка при загрузке расходов:", error)
		return ctx.reply("❌ Не удалось загрузить расходы. Попробуйте позже.", {
			reply_markup: defaultMenu,
		})
	}

	if (!expenses || expenses.length === 0) {
		return ctx.reply("📭 Нет расходов для удаления.", { reply_markup: defaultMenu })
	}

	for (const e of expenses) {
		const subcategory = e.subcategory ? ` (${e.subcategory})` : ""
		const label = `${getEmoji(e.category)} ${e.category}${subcategory} — ${e.amount}₸${
			e.comment ? ` (${e.comment})` : ""
		}`

		const keyboard = new InlineKeyboard().text("❌ Удалить", `delete_${e.id}`)

		await ctx.reply(`🧾 ${label}`, { reply_markup: keyboard })
	}
})

bot.callbackQuery(
	/^delete_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
	async ctx => {
		try {
			const id = ctx.match![1]
			const userId = await getUserId(ctx)

			const { data: expense, error: selectError } = await supabase
				.from("expenses")
				.select("user_id")
				.eq("id", id)
				.single()
			if (selectError) throw selectError
			if (expense?.user_id !== userId) {
				await ctx.answerCallbackQuery({ text: "❌ Это не ваш расход", show_alert: true })
				return
			}

			const { error } = await supabase.from("expenses").delete().eq("id", id)
			if (error) throw error

			await ctx.editMessageText("🗑️ Расход удалён.")
			await ctx.answerCallbackQuery({ text: "✅ Удалено", show_alert: false })
		} catch (err) {
			console.error("❌ Ошибка в callbackQuery:", err)
			await ctx.answerCallbackQuery({ text: "❌ Не удалось удалить", show_alert: true })
		}
	},
)

bot.callbackQuery(/^food_(.+)$/, async ctx => {
	try {
		const action = ctx.match![1]
		if (action === "cancel") {
			ctx.session.expectingFoodSubcategory = false
			ctx.session.pendingExpense = undefined
			await ctx.reply("🚫 Выбор подкатегории отменён.", { reply_markup: defaultMenu })
			await ctx.answerCallbackQuery()
			return
		}

		if (!ctx.session.pendingExpense) {
			await ctx.reply("❌ Ошибка: нет данных о расходе.", { reply_markup: defaultMenu })
			await ctx.answerCallbackQuery()
			return
		}

		const userId = await getUserId(ctx)
		const { category, comment, amount } = ctx.session.pendingExpense
		const subcategory =
			action === "yandex" ? "Яндекс" : action === "small" ? "Small" : "Продуктовый"

		const { error } = await supabase.from("expenses").insert({
			user_id: userId,
			amount,
			category,
			comment,
			subcategory,
			created_at: new Date(),
		})
		if (error) throw error

		ctx.session.expectingFoodSubcategory = false
		ctx.session.pendingExpense = undefined
		const subcategoryText = subcategory ? ` (${subcategory})` : ""
		await ctx.reply(
			`✅ Добавлено:\n• ${getEmoji(
				category,
			)} ${category}${subcategoryText} — ${amount} ₸${comment ? ` (${comment})` : ""}`,
			{ reply_markup: defaultMenu },
		)
		await ctx.answerCallbackQuery({ text: "✅ Подкатегория выбрана" })
	} catch (err) {
		console.error("❌ Ошибка при выборе подкатегории:", err)
		await ctx.answerCallbackQuery({ text: "❌ Ошибка при добавлении", show_alert: true })
	}
})

bot.hears("📊 Посчитать расходы", async ctx => {
	const userId = await getUserId(ctx)
	const month = getCurrentMonth()

	const { data: budgetRow, error: budgetError } = await supabase
		.from("months")
		.select("budget")
		.eq("user_id", userId)
		.eq("month", month)
		.single()
	if (budgetError && budgetError.code !== "PGRST116") {
		console.error("❌ Ошибка при загрузке бюджета:", budgetError)
		return ctx.reply("❌ Не удалось загрузить бюджет.", { reply_markup: defaultMenu })
	}

	const { data: expenses, error: expensesError } = await supabase
		.from("expenses")
		.select("amount, category, subcategory, created_at")
		.eq("user_id", userId)
		.gte("created_at", `${month}-01`)
	if (expensesError) {
		console.error("❌ Ошибка при загрузке расходов:", expensesError)
		return ctx.reply("❌ Не удалось загрузить расходы.", { reply_markup: defaultMenu })
	}

	const spent = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0
	const budget = budgetRow?.budget ?? 0
	const list = expenses?.length
		? expenses
				.map(e => {
					const category = e.subcategory ? `${e.category} (${e.subcategory})` : e.category
					const time = new Date(e.created_at).toLocaleString("ru-RU", {
						day: "2-digit",
						month: "2-digit",
						year: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					})
					return `• ${getEmoji(e.category)} ${category} — ${e.amount}₸\n(${time})\n`
				})
				.join("\n")
		: "Нет расходов"
	ctx.reply(
		`💸 Потрачено: ${spent} ₸\n📊 Остаток: ${budget - spent} ₸\n\n🧾 Расходы:\n${list}`,
		{ reply_markup: defaultMenu },
	)
})

bot.hears("📈 Тренды по категориям", async ctx => {
	const userId = await getUserId(ctx)
	const { data: expenses, error } = await supabase
		.from("expenses")
		.select("category, amount, subcategory")
		.eq("user_id", userId)
	if (error) {
		console.error("❌ Ошибка при загрузке расходов:", error)
		return ctx.reply("❌ Не удалось загрузить данные.", { reply_markup: defaultMenu })
	}
	if (!expenses || expenses.length === 0) {
		return ctx.reply("📭 Нет данных.", { reply_markup: defaultMenu })
	}
	const grouped = expenses.reduce((acc, e) => {
		const key = e.subcategory ? `${e.category} (${e.subcategory})` : e.category
		acc[key] = (acc[key] || 0) + e.amount
		return acc
	}, {} as Record<string, number>)
	const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1])
	const top = sorted
		.map(([cat, amt]) => `• ${getEmoji(cat.split(" ")[0])} ${cat} — ${amt} ₸`)
		.join("\n")
	ctx.reply(`📊 Топ расходов:\n${top}`, { reply_markup: defaultMenu })
})

bot.hears("📅 Месяцы", async ctx => {
	const userId = await getUserId(ctx)
	const { data: months, error: monthsError } = await supabase
		.from("months")
		.select("month, budget")
		.eq("user_id", userId)
		.order("month", { ascending: false })
	if (monthsError) {
		console.error("❌ Ошибка при загрузке месяцев:", monthsError)
		return ctx.reply("❌ Не удалось получить данные.", { reply_markup: defaultMenu })
	}
	if (!months || months.length === 0) {
		return ctx.reply("📭 Нет сохранённых месяцев.", { reply_markup: defaultMenu })
	}

	const { data: expenses, error: expensesError } = await supabase
		.from("expenses")
		.select("amount, created_at")
		.eq("user_id", userId)
	if (expensesError) {
		console.error("❌ Ошибка при загрузке расходов:", expensesError)
		return ctx.reply("❌ Не удалось загрузить расходы.", { reply_markup: defaultMenu })
	}

	const result = months.map(({ month, budget }) => {
		const monthStart = `${month}-01`
		const nextMonth = new Date(`${month}-01`)
		nextMonth.setMonth(nextMonth.getMonth() + 1)
		const monthEnd = `${nextMonth.getFullYear()}-${String(
			nextMonth.getMonth() + 1,
		).padStart(2, "0")}-01`
		const spent = expenses
			.filter(e => e.created_at >= monthStart && e.created_at < monthEnd)
			.reduce((sum, e) => sum + e.amount, 0)
		const left = budget - spent
		return `📅 ${month}\n💰 Бюджет: ${budget} ₸\n💸 Потрачено: ${spent} ₸\n💵 Остаток: ${left} ₸`
	})

	await ctx.reply(result.join("\n\n"), { reply_markup: defaultMenu })
})

bot.hears("💡 Советы по экономии", async ctx => {
	ctx.session.expectingSaveGoal = true
	ctx.reply(
		"💾 Сколько ты хочешь сохранить в этом месяце? (в тенге, положительное число до 1,000,000,000)",
		{
			reply_markup: new Keyboard().text("Отмена").resized(),
		},
	)
})

bot.hears("❌ Сбросить месяц", async ctx => {
	ctx.session.confirmResetStep = 1
	ctx.reply("⚠️ Ты точно хочешь сбросить текущий месяц? Напиши `Да`, если уверен.", {
		reply_markup: new Keyboard().text("Отмена").resized(),
	})
})

bot.on("message:text", async ctx => {
	const text = ctx.message.text
	const userId = await getUserId(ctx)
	const month = getCurrentMonth()

	if (ctx.session.confirmResetStep === 1 && text.toLowerCase() === "да") {
		ctx.session.confirmResetStep = 2
		return ctx.reply(
			"🛑 Подтверди ещё раз: сбросить все данные за месяц? Напиши `Да` повторно.",
			{ reply_markup: new Keyboard().text("Отмена").resized() },
		)
	}
	if (ctx.session.confirmResetStep === 2 && text.toLowerCase() === "да") {
		try {
			const [expensesRes, monthsRes] = await Promise.all([
				supabase
					.from("expenses")
					.delete()
					.eq("user_id", userId)
					.gte("created_at", `${month}-01`),
				supabase.from("months").delete().eq("user_id", userId).eq("month", month),
			])
			if (expensesRes.error || monthsRes.error) {
				throw expensesRes.error || monthsRes.error
			}
			ctx.session.confirmResetStep = undefined
			await ctx.reply("✅ Месяц сброшен.\n\n🧭 Начни заново: нажми `Новый месяц`", {
				reply_markup: new Keyboard().text("Новый месяц").resized(),
			})
		} catch (error) {
			console.error("❌ Ошибка при сбросе месяца:", error)
			await ctx.reply("❌ Не удалось сбросить месяц. Попробуйте позже.", {
				reply_markup: defaultMenu,
			})
		}
		return
	}

	if (ctx.session.expectingBudget) {
		const budget = parseInt(text)
		if (isNaN(budget) || budget <= 0) {
			return ctx.reply("❌ Введите положительное число для бюджета.", {
				reply_markup: new Keyboard().text("Отмена").resized(),
			})
		}
		if (budget > 1_000_000_000) {
			return ctx.reply("❌ Бюджет слишком большой, попробуйте реалистичную сумму.", {
				reply_markup: new Keyboard().text("Отмена").resized(),
			})
		}
		try {
			const { error } = await supabase
				.from("months")
				.upsert({ user_id: userId, month, budget, created_at: new Date() })
			if (error) throw error
			ctx.session.expectingBudget = false
			return ctx.reply(`✅ Установлен бюджет на ${month}: ${budget} ₸`, {
				reply_markup: defaultMenu,
			})
		} catch (error) {
			console.error("❌ Ошибка при установке бюджета:", error)
			return ctx.reply("❌ Не удалось установить бюджет. Попробуйте позже.", {
				reply_markup: defaultMenu,
			})
		}
	}

	if (ctx.session.addingExpense) {
		const lines = text.split("\n")
		const results = lines
			.map((line, i) => ({ line, parsed: parseExpenseLine(line), index: i + 1 }))
			.filter(item => item.parsed)
		const failed = lines
			.map((line, i) => ({ line, parsed: parseExpenseLine(line), index: i + 1 }))
			.filter(item => !item.parsed)
		if (results.length === 0) {
			const errorMsg =
				"❌ Не удалось распознать расходы. Используйте формат:\n" +
				"еда 5000\nили\nеда - ужин 5000" +
				(failed.length > 0
					? `\n\nОшибочные строки:\n${failed
							.map(f => `Строка ${f.index}: ${f.line}`)
							.join("\n")}`
					: "")
			return ctx.reply(errorMsg, {
				reply_markup: new Keyboard().text("Отмена").resized(),
			})
		}

		const expense = results[0].parsed!
		if (expense.category.toLowerCase() === "еда") {
			ctx.session.expectingFoodSubcategory = true
			ctx.session.pendingExpense = expense
			return ctx.reply("🍔 Уточните категорию еды:", {
				reply_markup: foodSubcategoryKeyboard,
			})
		}

		try {
			const expenses = [
				{
					user_id: userId,
					amount: expense.amount,
					category: expense.category,
					comment: expense.comment,
					created_at: new Date(),
				},
			]
			const { error } = await supabase.from("expenses").insert(expenses)
			if (error) throw error
			ctx.session.addingExpense = false
			const successMsg =
				`✅ Добавлено:\n` +
				`• ${getEmoji(expense.category)} ${expense.category} — ${expense.amount} ₸${
					expense.comment ? ` (${expense.comment})` : ""
				}` +
				(failed.length > 0
					? `\n\n⚠️ Не удалось распознать:\n${failed
							.map(f => `Строка ${f.index}: ${f.line}`)
							.join("\n")}`
					: "")
			return ctx.reply(successMsg, { reply_markup: defaultMenu })
		} catch (error) {
			console.error("❌ Ошибка при добавлении расходов:", error)
			return ctx.reply("❌ Не удалось добавить расходы. Попробуйте позже.", {
				reply_markup: defaultMenu,
			})
		}
	}

	if (ctx.session.expectingSaveGoal) {
		const goal = parseInt(text)
		if (isNaN(goal) || goal <= 0) {
			return ctx.reply("❌ Введите положительное число для цели.", {
				reply_markup: new Keyboard().text("Отмена").resized(),
			})
		}
		if (goal > 1_000_000_000) {
			return ctx.reply("❌ Цель слишком большая, попробуйте реалистичную сумму.", {
				reply_markup: new Keyboard().text("Отмена").resized(),
			})
		}
		try {
			const { data: budgetRow, error: budgetError } = await supabase
				.from("months")
				.select("budget")
				.eq("user_id", userId)
				.eq("month", month)
				.single()
			if (budgetError && budgetError.code !== "PGRST116") throw budgetError
			const { data: expenses, error: expensesError } = await supabase
				.from("expenses")
				.select("amount")
				.eq("user_id", userId)
				.gte("created_at", `${month}-01`)
			if (expensesError) throw expensesError
			const spent = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0
			const budget = budgetRow?.budget ?? 0
			const left = budget - spent
			const days = daysLeftInMonth()
			const perDay = Math.floor((left - goal) / days)
			ctx.session.expectingSaveGoal = false
			if (left >= goal) {
				return ctx.reply(
					`📊 Чтобы сохранить ${goal} ₸:\n\n• Осталось дней: ${days}\n• Лимит на день: ${perDay} ₸\n\n🔥 Ты справишься!`,
					{ reply_markup: defaultMenu },
				)
			} else {
				const needToCut = goal - left
				return ctx.reply(
					`⚠️ Чтобы сохранить ${goal} ₸, нужно сократить расходы на ${needToCut} ₸.\n\nСейчас уже не хватает средств для этой цели.`,
					{ reply_markup: defaultMenu },
				)
			}
		} catch (error) {
			console.error("❌ Ошибка при расчёте цели:", error)
			return ctx.reply("❌ Не удалось рассчитать цель. Попробуйте позже.", {
				reply_markup: defaultMenu,
			})
		}
	}
})

bot.catch(err => {
	console.error("❌ Глобальная ошибка:", err)
})

// bot.start()
export default webhookCallback(bot, "https")
