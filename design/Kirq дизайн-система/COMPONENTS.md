# KIRQ — краткий гайд по компонентам

Токены: `design-tokens.css` (все цвета/шрифты/отступы ниже — ссылки на них).
Шрифты: Google Fonts — Rajdhani (500/600/700) + JetBrains Mono (400/500/700).
База: тёмная консоль, углы **без скруглений** (`--kq-radius: 0`); подпись бренда — срез угла (chamfer) через `clip-path`.

## Принципы
- Один яркий цвет — янтарь `--kq-accent`. Зелёный/красный только семантика (win/loss), бирюза/оранж — только группы рангов.
- Все подписи секций: JetBrains Mono 10px, UPPERCASE, letter-spacing .2em, цвет `--kq-text-dim`.
- Все числа (Elo, таймеры, коды, счёт) — JetBrains Mono. Весь остальной UI — Rajdhani, лейблы капсом.
- Фон экранов: `--kq-bg-0` + сетка `--kq-grid-bg` (24px) на «игровых» зонах.
- Hover primary-кнопок: фон → `--kq-accent-hi`. Hover ghost: бордер/текст → accent.

## Компоненты

**Button / Primary** — фон accent, текст `--kq-accent-ink`, Rajdhani 700, ls .16em, chamfer 10–14px (правый-нижний угол, `.kq-chamfer-btn`). Крупная (PLAY/CONNECT): 26–28px текст, ls .22–.26em, padding 16–18px.

**Button / Ghost** — прозрачный, бордер 1px: нейтральный `--kq-line-2` + текст muted; акцентный `--kq-accent-line` + текст accent; danger `--kq-loss-line` + текст loss. Без chamfer.

**Card** — фон `--kq-surface` или `--kq-bg-1`, бордер 1px `--kq-line`, radius 0, padding 16–24px. Выбранная/активная: двухслойный chamfer-card (внешний слой accent, внутренний inset 1px фон `--kq-surface-2`, `.kq-chamfer-card`, срез верхний-правый 16px). Акцент-тонированная (host, ваш ход): фон `--kq-accent-tint`, бордер `--kq-accent-line`.

**Rank badge** — гексагон `.kq-hex`, два слоя: внешний = цвет группы ранга, внутренний inset 2px = фон подложки, номер уровня внутри (Mono 700, цвет группы). Размеры 22/28/34/44px. Группы: 1 серый, 2–3 бирюза, 4–7 янтарь, 8–9 оранж, 10 красный. Top-10 лидерборда: Challenger — `--kq-rank-chal` + glow `--kq-glow-accent`, внутри `#место` вместо уровня.

**Input** — фон `--kq-bg-0`, бордер `--kq-line-2`, radius 0, Rajdhani 14–15px; placeholder `--kq-text-dim`; focus/filled: бордер accent. Мобайл: min-height 44px.

**Copy field** — контейнер как input, значение Mono 700 accent слева + кнопка COPY (мини-ghost accent, Mono 9–10px) справа. Используется: код верификации, код карты, ссылка комнаты.

**Segmented / Tabs** — ряд ячеек в общем бордере `--kq-line`; активная: фон accent + текст ink (табы) или фон `--kq-surface-2` (фильтры).

**Tag / Pill** — прямоугольник без radius, Rajdhani 700 10px ls .1em: WIN фон win/текст ink; LOSS фон loss; PENDING фон `#2C3441`/текст muted; ◆ CAPTAIN фон accent; HOST/LIVE — ghost на `--kq-accent-tint` (LIVE пульсирует).

**Chat message** — колонка: имя (Rajdhani 600 12px muted + время Mono 10px dim) → пузырь. Чужой: фон `--kq-surface`, бордер line, слева. Свой: фон `--kq-surface-2`, правый бордер 2px accent, справа. Системное: по центру, Mono 11px dim, обрамление «—». Ссылка на комнату: подчёркнутая Mono accent + рядом кнопка CONNECT (primary-chamfer мини). Инпут чата + SEND (ghost accent) внизу.

**Map card (veto)** — фон surface, бордер line; превью 16:9 (image-slot / скриншот), плашка: имя Rajdhani 700 15px ls .1em + код Mono 10px dim. Доступная в твой ход: hover — бордер accent + glow + тег «BAN ✕». Забаненная: opacity .55, превью → полосы `--kq-stripes` + красный ✕, имя перечёркнуто, подпись `BANNED · <кто>` Mono 9px loss.

**Host panel** — правая колонка `--kq-host-panel-w` (430px), фон `--kq-bg-1`; шапка: «HOST PANEL» accent + тег «YOU — HIGHEST ELO» + «HIDE ⌃». Список настроек: строки label(Mono dim)/value(Rajdhani 700 16px), ряд MAP CODE выделен фоном + COPY. Ниже input «room link» + PUBLISH ROOM (primary). Отдельный модуль: скрывается целиком, когда комнату поднимает бот; сетка экрана при этом — просто одна колонка чата.

**Queue radar** — круг 104px: 2 кольца бордером line, вращающийся `conic-gradient` accent (`kq-spin` 2.2s), пульс-точка в центре (`kq-pulse` 1.4s). Таймер Mono 700 40px accent.

**Turn strip (veto)** — полоса `--kq-accent-tint` + бордер `--kq-accent-line`: «▸ YOUR BAN» (пульс) + прогресс-бар 6px accent + таймер Mono 20px.

**Анимации** — только две: `kq-spin` (радар/спиннеры) и `kq-pulse` (LIVE, точки, «твой ход»). Ничего не летает и не скользит.
