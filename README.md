# KIRQ — Kirka PUGs

Рейтинговый матчмейкинг («FACEIT») для kirka.io: очереди 1v1 Duel / 2v2 Point, Elo и
дивизионы, бан/пик региона и карт, чат матча, ручной хостинг комнаты игроком с
максимальным Elo, подтверждение результатов скриншотами, споры, сезоны, админка.

**Стек:** Next.js (App Router, TypeScript) на Vercel + Supabase (Postgres, Auth,
Realtime, Storage, pg_cron). Игрового бота нет — комнату хостит человек.

---

## Структура

| Путь | Что это |
| --- | --- |
| `src/config/game.ts` | ЕДИНЫЙ конфиг: режимы, регионы, Elo, ROOM_SETTINGS, дивизионы |
| `src/styles/design-tokens.css` | Дизайн-токены (копия из `/design`, единственный источник стиля) |
| `supabase/migrations/*.sql` | Схема БД, RLS, игровая логика (SQL-функции), storage, сид |
| `src/lib/roomProvider.ts` | Абстракция RoomProvider (сейчас ManualHost; граница для авто-хоста) |
| `src/lib/maps.ts` | Пул карт из `/public/maps/{1v1,2v2}` — имя файла = карта, файл = превью |
| `src/app/match/[id]` | Окно матча: вето → лобби → ready → старт → результаты |
| `src/app/api/cron/tick` | Cron-свип: матчмейкер, авто-баны по таймауту, авто-подтверждения |

**Карты.** Ничего не хардкодится: превью читаются из `/public/maps/1v1` и
`/public/maps/2v2`. Коды карт — `/public/maps/maps.json`: поддерживаются оба
формата — JSON-файл `{"ИмяКарты":"код"}` **или** папка `maps.json/` с файлами
`<ИмяКарты>.txt` (полный экспорт карты Kirka, как сейчас в репозитории). Есть код →
у карты появляется кнопка COPY (код отдаётся через `/api/maps`, в бандл не попадает).

**Матчмейкер.** Без постоянного процесса: SQL-функция `run_matchmaker()`
(advisory-lock) вызывается 1) при входе в очередь, 2) каждые 5 с поллингом ждущих
клиентов (`GET /api/queue`), 3) Vercel-кроном раз в минуту, 4) опционально pg_cron
каждые 5 с (см. ниже). Окно Elo: ±100, +50 за каждые 30 с ожидания.

**Безопасность.** RLS на всех таблицах: клиенты только читают (чат/ссылки/результаты
— только участникам). Все записи идут через API-роуты с service-role после серверной
валидации + SECURITY DEFINER-функции с проверками хода/ролей/статусов и
rate-limit'ами (очередь, чат, результаты, комната).

---

## Деплой: пошагово

### 1. Supabase-проект

1. [supabase.com](https://supabase.com) → New project. Запишите:
   `Project URL`, `anon key`, `service_role key` (Settings → API).
2. **Auth → Providers → Discord**: включите. Создайте приложение на
   [discord.com/developers](https://discord.com/developers/applications) → OAuth2 →
   Redirect: `https://<PROJECT>.supabase.co/auth/v1/callback`. Вставьте Client ID/Secret.
   Discord — единственный способ входа (email-вход в приложении отключён).
3. **Auth → URL Configuration**: Site URL = ваш прод-домен
   (`https://kirq.vercel.app`), Additional Redirect URLs:
   `http://localhost:3000/auth/callback`, `https://<домен>/auth/callback`.

### 2. Миграции

Вариант А — Supabase CLI:
```bash
npm i -g supabase
supabase link --project-ref <PROJECT_REF>
supabase db push        # применит supabase/migrations/*.sql по порядку
```
Вариант Б — Dashboard → SQL Editor: выполните по очереди
`0001_schema.sql` → `0002_rls.sql` → `0003_functions.sql` → `0004_storage_seed.sql`.

Опционально (полностью серверный матчмейкер каждые 5 с): Dashboard → Database →
Extensions → включить `pg_cron`, затем в SQL Editor:
```sql
select cron.schedule('kirq-matchmaker', '5 seconds',
  $$ select public.run_matchmaker(); select public.apply_timeouts(); $$);
```

### 3. Env на Vercel

Импортируйте репозиторий в Vercel и задайте переменные (Settings → Environment
Variables), список — в `.env.example`:

| Переменная | Значение |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (секрет!) |
| `CRON_SECRET` | случайная строка — Vercel сам подставит её в cron-запросы |
| `NEXT_PUBLIC_SITE_URL` | прод-URL |

### 4. Деплой

Deploy. Cron из `vercel.json` (`/api/cron/tick`, раз в минуту) Vercel подключит
автоматически. Для локальной разработки: скопируйте `.env.example` → `.env.local`,
заполните, `npm run dev`.

### 5. Назначить админа

SQL Editor:
```sql
update public.profiles set role = 'admin' where username = '<ваш ник>';
```
После этого в топбаре появится ADMIN: споры со скриншотами, ручная правка Elo,
баны, проверка скриншотов привязки, лог действий.

### 6. Сезоны

Новый сезон:
```sql
update public.seasons set active = false, ends_at = now() where active;
insert into public.seasons (name, active) values ('Season 2', true);
```
Рейтинги сезонные (создаются лениво при первом входе в очередь), лидерборд имеет
фильтр по сезонам.

---

## Как играется матч (порядок фаз)

1. **PLAY** — игрок выбирает только режим; регион в очереди не выбирается.
2. Матч найден → **бан регионов**: капитаны (макс. Elo команды) по очереди банят
   из NA/EU/ASIA, остаётся один. 30 с на ход, авто-бан по таймауту.
3. **Бан карт** той же механикой до одной карты.
4. **Лобби**: у хоста (макс. Elo матча) — Host panel с точными настройками комнаты
   из `ROOM_SETTINGS` + код карты (COPY) + поле «вставь ссылку на комнату».
5. Ссылка опубликована → у остальных **CONNECT** (копирует и открывает); ссылки
   kirka.io в чате тоже получают кнопку CONNECT.
6. Все зашли → каждый жмёт **READY**; когда все готовы, хост вводит **время старта**
   по внутриигровым часам Kirka (например `58:30`) — оно крупно видно всем.
7. После игры обе стороны вносят счёт + **обязательный скриншот**. Совпало →
   авто-подтверждение и пересчёт Elo (K=32; в 2v2 — по среднему Elo команд).
   Не совпало → спор в админку. Одностороннний результат
   авто-подтверждается через 15 мин. Неявка после чужого READY — −25 Elo.
