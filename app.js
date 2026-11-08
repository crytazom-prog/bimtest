/* BIMduo — тренажёр по информационному моделированию */
(function () {
  "use strict";

  const V1 = window.COURSE_V1;
  const V2 = window.COURSE_V2;
  const ALL = [...V1.tasks, ...V2.tasks];
  const BY_ID = {};
  ALL.forEach(t => { BY_ID[t.id] = t; });

  const SECTION_LABEL = { "1.1": "Соответствие", "1.2": "Последовательность", "1.3": "Тест", "1.4": "Открытый ответ" };
  const TYPE_LABEL = { match: "Соответствие", order: "Последовательность", choice: "Тест", open: "Открытый ответ" };
  const LETTERS = "АБВГДЕ";

  const MATCH_LABELS = {
    "v1-1": ["Конструктивный элемент", "Характеристика"],
    "v1-2": ["Тип узла", "Назначение"],
    "v1-3": ["Тип данных", "Пример"],
    "v1-4": ["Тип документации", "Содержание"],
    "v1-5": ["Характеристика", "Версия IFC"],
    "v1-6": ["Элемент интерфейса", "Назначение"],
    "v1-7": ["BIM-задача", "Этап жизненного цикла"],
    "v1-8": ["Код в имени файла", "Значение"],
    "v1-9": ["Формат файла", "Назначение"],
    "v1-10": ["Инструмент Revit", "Функция"],
    "v2-1": ["Понятие", "Определение"],
    "v2-2": ["Инструмент", "Функция"],
    "v2-3": ["Термин", "Значение"],
    "v2-4": ["Код", "Расшифровка"],
    "v2-5": ["Тип ПО", "Назначение"],
    "v2-6": ["Задача", "Формат"],
    "v2-7": ["Элемент", "Характеристика"],
    "v2-8": ["Тип узла", "Назначение"],
    "v2-9": ["Тип данных", "Пример"],
    "v2-10": ["Документация", "Содержание"]
  };

  const app = document.getElementById("app");

  /* ---------------- учебный путь ---------------- */
  const SECTION_META = {
    "1.1": { title: "Соответствия", ico: "🔗", color: "green" },
    "1.2": { title: "Последовательности", ico: "🔢", color: "blue" },
    "1.3": { title: "Выбор ответа", ico: "📝", color: "yellow" },
    "1.4": { title: "Открытые вопросы", ico: "💬", color: "purple" }
  };

  const LEVELS = [];
  [["v1", V1], ["v2", V2]].forEach(([key, course]) => {
    ["1.1", "1.2", "1.3", "1.4"].forEach(sec => {
      LEVELS.push({
        id: key + "-" + sec,
        variant: key,
        section: sec,
        kind: "lesson",
        tasks: course.tasks.filter(t => t.section === sec),
        title: SECTION_META[sec].title,
        ico: SECTION_META[sec].ico
      });
    });
    LEVELS.push({
      id: key + "-test",
      variant: key,
      section: "test",
      kind: "test",
      tasks: course.tasks.filter(t => t.type !== "open"),
      title: "Тест варианта",
      ico: "🏁"
    });
  });

  /* ---------------- storage ---------------- */
  const KEY = "bimduo_store_v1";
  const DEFAULT_STORE = { xp: 0, done: {}, levels: {}, mistakes: [], attempts: 0, correctTotal: 0, bestStreak: 0, sound: true };
  let store = loadStore();

  function loadStore() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? Object.assign({}, DEFAULT_STORE, JSON.parse(raw)) : { ...DEFAULT_STORE };
    } catch (e) { return { ...DEFAULT_STORE }; }
  }
  function saveStore() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* file:// без localStorage */ }
  }

  /* ---------------- helpers ---------------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pct(part, total) { return total ? Math.round(part / total * 100) : 0; }

  /* ---------------- звук ---------------- */
  let actx = null;
  function beep(kind) {
    if (!store.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === "ok" ? [[660, 0], [880, 0.09]] : [[220, 0], [160, 0.10]];
      notes.forEach(([f, delay]) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = kind === "ok" ? "sine" : "square";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, actx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(kind === "ok" ? 0.12 : 0.05, actx.currentTime + delay + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + delay + 0.16);
        o.connect(g); g.connect(actx.destination);
        o.start(actx.currentTime + delay);
        o.stop(actx.currentTime + delay + 0.18);
      });
    } catch (e) { /* без звука */ }
  }

  /* ---------------- состояние ---------------- */
  let session = null;
  let Q = null;

  function newSession(deck, title, mode) {
    session = {
      deck, title, mode, idx: 0, xp: 0, correct: 0, answered: 0,
      streak: 0, bestStreak: 0, mistakes: [], start: Date.now(),
      exam: mode === "test"
    };
  }

  /* ================= УЧЕБНЫЙ ПУТЬ ================= */
  function hasLevel(id) {
    return !!(store.levels && Object.prototype.hasOwnProperty.call(store.levels, id));
  }
  function levelBest(id) {
    return store.levels ? (store.levels[id] || 0) : 0;
  }
  function levelUnlocked(i) {
    if (i <= 0) return true;
    return hasLevel(LEVELS[i - 1].id);
  }
  function firstIncomplete() {
    return LEVELS.findIndex(l => !hasLevel(l.id));
  }

  function unitBannerHTML(variant, num) {
    const lvls = LEVELS.filter(l => l.variant === variant);
    const doneCount = lvls.filter(l => hasLevel(l.id)).length;
    const p = pct(doneCount, lvls.length);
    return `<div class="unit-banner ${variant === "v2" ? "blue" : ""}">
      <div class="unit-kicker">Раздел ${num}</div>
      <div class="unit-title">Вариант ${num} · ${variant === "v1" ? "база и инструменты" : "практика и данные"}</div>
      <div class="unit-sub">${doneCount} из ${lvls.length} уровней пройдено</div>
      <div class="unit-progress"><i style="width:${p}%"></i></div>
    </div>`;
  }

  function pathHTML(variant) {
    const lvls = LEVELS.filter(l => l.variant === variant);
    const OFF = variant === "v2" ? [0, -80, -114, -80, 0] : [0, 80, 114, 80, 0];
    const cur = firstIncomplete();
    return `<div class="path">${lvls.map(lv => {
      const i = LEVELS.indexOf(lv);
      const done = hasLevel(lv.id);
      const unlocked = levelUnlocked(i);
      const current = unlocked && !done && i === cur;
      const best = levelBest(lv.id);
      const secLabel = lv.kind === "test" ? "Итог" : lv.section;
      return `<div class="path-row" style="--off:${OFF[LEVELS.filter(l => l.variant === variant).indexOf(lv)]}">
        <div class="node-wrap">
          ${current ? `<span class="start-bubble">Начать</span>` : ""}
          <button class="node ${done ? "done" : ""} ${unlocked ? "" : "locked"} ${current ? "current" : ""} ${lv.kind}"
            data-level="${lv.id}" ${unlocked ? "" : "disabled"} title="${esc(lv.title)}${unlocked ? "" : " — сначала пройди предыдущий уровень"}">
            <span class="node-ico">${done ? "✓" : unlocked ? lv.ico : "🔒"}</span>
          </button>
          ${done ? `<span class="node-pct">${best}%</span>` : ""}
        </div>
        <div class="node-label ${unlocked ? "" : "muted"}">${secLabel} · ${lv.kind === "test" ? "Тест варианта" : lv.title}</div>
      </div>`;
    }).join("")}</div>`;
  }

  /* ================= ОБЩАЯ ОБВЯЗКА ЭКРАНОВ ================= */
  function topbarHTML() {
    return `<header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="logo">B</div>
          <div class="brand-text"><b>BIMduo</b><span>тренажёр к срезу</span></div>
        </div>
        <div class="top-actions">
          <div class="pill"><span class="pill-ico">🔥</span><b>${store.bestStreak}</b></div>
          <div class="pill"><span class="pill-ico">⚡</span><b>${store.xp}</b> XP</div>
          <button class="icon-btn" id="soundBtn" title="Звук">${store.sound ? "🔊" : "🔇"}</button>
        </div>
      </div>
    </header>`;
  }

  function tabsHTML(active) {
    return `<nav class="tabs">
      <button class="tab ${active === "course" ? "active" : ""}" id="tabCourse">Курс</button>
      <button class="tab ${active === "answers" ? "active" : ""}" id="tabAnswers">Ответы</button>
    </nav>`;
  }

  function bindChrome(rerender) {
    const c = document.getElementById("tabCourse");
    const a = document.getElementById("tabAnswers");
    if (c) c.addEventListener("click", renderHome);
    if (a) a.addEventListener("click", () => { ansQuery = ""; ansFilter = "all"; renderAnswers(); });
    const s = document.getElementById("soundBtn");
    if (s) s.addEventListener("click", () => { store.sound = !store.sound; saveStore(); rerender(); });
  }

  /* ================= ГЛАВНЫЙ ЭКРАН ================= */
  function renderHome() {
    session = null; Q = null;
    const studied = Object.values(store.done).filter(d => d.ok).length;
    const acc = pct(store.correctTotal, store.attempts);
    const pAll = pct(studied, ALL.length);
    const doneLevels = LEVELS.filter(l => hasLevel(l.id)).length;
    const reviewSize = Math.min(10, studied) || 10;

    app.innerHTML = `
      ${topbarHTML()}

      <main class="home">
        ${tabsHTML("course")}
        <section class="path-hero">
          <div class="hero-text">
            <div class="eyebrow">Курс подготовки · 80 заданий</div>
            <h1>Учись по уровням</h1>
            <p>Проходи уровни по порядку: после каждого ответа — объяснение. Следующий открывается сразу после предыдущего.</p>
            <div class="hero-chips">
              <span class="hero-chip">⚡ ${store.xp} XP</span>
              <span class="hero-chip">📘 ${studied} / 80 изучено</span>
              <span class="hero-chip">🏁 ${doneLevels} / ${LEVELS.length} уровней</span>
              <span class="hero-chip">🎯 ${store.attempts ? acc + "%" : "—"} точность</span>
            </div>
          </div>
          <div class="mascot" aria-hidden="true">🏗️</div>
        </section>

        ${unitBannerHTML("v1", 1)}
        ${pathHTML("v1")}

        ${unitBannerHTML("v2", 2)}
        ${pathHTML("v2")}

        <div class="section-title">
          <h2>Свободная тренировка</h2>
          <span>без блокировки уровней</span>
        </div>

        <section class="side-grid">
          <button class="course-card c-blue" data-mode="review">
            <div class="course-ico">🔁</div>
            <div class="course-kicker">Повторение</div>
            <div class="course-title">Повторение прошлого</div>
            <div class="course-sub">${reviewSize} заданий из уже пройденного — сначала те, что давно не повторяли</div>
            <div class="course-go">Повторить →</div>
          </button>

          <button class="course-card c-green" data-mode="random">
            <div class="course-ico">🎲</div>
            <div class="course-kicker">Тренировка</div>
            <div class="course-title">Случайные 20</div>
            <div class="course-sub">20 заданий вперемешку из обоих вариантов</div>
            <div class="course-go">Начать →</div>
          </button>

          <button class="course-card c-purple" data-mode="all">
            <div class="course-ico">★</div>
            <div class="course-kicker">Полный прогон</div>
            <div class="course-title">Все 80 заданий</div>
            <div class="course-sub">подряд без остановок · изучено ${pAll}%</div>
            <div class="course-go">Пройти →</div>
          </button>

          ${store.mistakes.length ? `
          <button class="course-card c-red" data-mode="mistakes">
            <div class="course-ico">↻</div>
            <div class="course-kicker">Ошибки</div>
            <div class="course-title">Повторить ошибки</div>
            <div class="course-sub">${store.mistakes.length} задани${store.mistakes.length === 1 ? "е" : store.mistakes.length < 5 ? "я" : "й"} с прошлых попыток</div>
            <div class="course-go">Исправить →</div>
          </button>` : `
          <div class="course-card c-yellow">
            <div class="course-ico">💡</div>
            <div class="course-kicker">Совет</div>
            <div class="course-title">Как заниматься</div>
            <div class="course-sub">Иди по уровням сверху вниз. Ошибки собираются в отдельный урок.</div>
          </div>`}
        </section>

        <p class="footnote">Прогресс сохраняется в этом браузере. Работает офлайн: просто открой файл <code>index.html</code>.</p>
      </main>`;

    bindHome();
  }

  function bindHome() {
    document.querySelectorAll("[data-mode]").forEach(btn => {
      btn.addEventListener("click", () => startMode(btn.dataset.mode));
    });
    document.querySelectorAll("[data-level]").forEach(btn => {
      btn.addEventListener("click", () => {
        const lv = LEVELS.find(l => l.id === btn.dataset.level);
        if (lv && !btn.disabled) startLevel(lv);
      });
    });
    bindChrome(renderHome);
  }

  /* ================= ВКЛАДКА «ОТВЕТЫ» ================= */
  let ansFilter = "all";
  let ansQuery = "";

  function renderAnswers() {
    session = null; Q = null;
    app.innerHTML = `
      ${topbarHTML()}
      <main class="answers">
        ${tabsHTML("answers")}

        <div class="answers-head">
          <div class="eyebrow">Шпаргалка</div>
          <h1>Все ответы</h1>
          <p>80 заданий: эталонные ответы и объяснения. Ищи по вопросу, ответу или теме.</p>

          <div class="answers-filters">
            <div class="seg">
              <button class="seg-btn ${ansFilter === "all" ? "active" : ""}" data-f="all">Все 80</button>
              <button class="seg-btn ${ansFilter === "v1" ? "active" : ""}" data-f="v1">Вариант 1</button>
              <button class="seg-btn ${ansFilter === "v2" ? "active" : ""}" data-f="v2">Вариант 2</button>
            </div>
            <div class="search-wrap">
              <span class="search-ico">🔎</span>
              <input id="ansSearch" class="ans-search" type="search" placeholder="Поиск по вопросу и ответу" value="${esc(ansQuery)}">
            </div>
          </div>
          <div class="ans-count" id="ansCount"></div>
        </div>

        <div id="answersList"></div>
      </main>`;

    document.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => {
      ansFilter = b.dataset.f;
      renderAnswers();
    }));
    const inp = document.getElementById("ansSearch");
    inp.addEventListener("input", () => { ansQuery = inp.value; renderAnswerList(); });
    bindChrome(renderAnswers);
    renderAnswerList();
  }

  function answerCardHTML(t, variant) {
    return `<article class="ans-item">
      <div class="ans-top">
        <span class="ans-num">№ ${t.n}</span>
        <span class="ans-type">${TYPE_LABEL[t.type] || ""}</span>
        <span class="ans-variant">${variant === "v1" ? "Вариант 1" : "Вариант 2"} · ${t.section}</span>
      </div>
      <div class="ans-q">${esc(t.prompt)}</div>
      <div class="ans-a">
        <div class="ans-a-label">Ответ</div>
        ${answerSummary(t)}
      </div>
      <div class="ans-e">
        <div class="ans-a-label">Объяснение</div>
        ${esc(t.explain || "")}
      </div>
    </article>`;
  }

  function renderAnswerList() {
    const box = document.getElementById("answersList");
    if (!box) return;
    const q = ansQuery.trim().toLowerCase().replace(/ё/g, "е");
    let found = 0;
    let html = "";

    [["v1", V1, "Вариант 1"], ["v2", V2, "Вариант 2"]].forEach(([key, course, label]) => {
      if (ansFilter !== "all" && ansFilter !== key) return;
      ["1.1", "1.2", "1.3", "1.4"].forEach(sec => {
        const tasks = course.tasks.filter(t =>
          t.section === sec &&
          (!q || JSON.stringify(t).toLowerCase().replace(/ё/g, "е").includes(q))
        );
        if (!tasks.length) return;
        found += tasks.length;
        html += `<section class="ans-group">
          <div class="ans-group-title">${label} · ${sec} ${SECTION_META[sec].title}</div>
          ${tasks.map(t => answerCardHTML(t, key)).join("")}
        </section>`;
      });
    });

    box.innerHTML = html || `<div class="ans-empty">Ничего не нашлось. Попробуй другой запрос.</div>`;
    const cnt = document.getElementById("ansCount");
    if (cnt) cnt.textContent = `Найдено: ${found} из 80`;
  }

  /* ================= ЗАПУСК КОЛОДЫ ================= */
  function startMode(mode) {
    if (mode === "v1") { newSession(V1.tasks, "Вариант 1", "v1"); }
    else if (mode === "v2") { newSession(V2.tasks, "Вариант 2", "v2"); }
    else if (mode === "all") { newSession(ALL, "Все задания", "all"); }
    else if (mode === "random") { newSession(shuffle(ALL).slice(0, 20), "Случайные 20", "random"); }
    else if (mode === "lesson") {
      const fresh = ALL.filter(t => !(store.done[t.id] && store.done[t.id].ok));
      const deck = (fresh.length ? fresh : shuffle(ALL)).slice(0, 10);
      newSession(deck, "Урок", "lesson");
    }
    else if (mode === "review") {
      const learned = ALL.filter(t => store.done[t.id] && store.done[t.id].ok);
      let deck;
      if (learned.length) {
        deck = learned.slice()
          .sort((a, b) => (store.done[a.id].last || 0) - (store.done[b.id].last || 0))
          .slice(0, 10);
      } else {
        deck = shuffle(ALL).slice(0, 10);
      }
      newSession(deck, "Повторение прошлого", "review");
    }
    else if (mode === "test") {
      const pool = ALL.filter(t => t.type !== "open");
      newSession(shuffle(pool).slice(0, 20), "Тест", "test");
    }
    else if (mode === "mistakes") {
      const deck = store.mistakes.map(id => BY_ID[id]).filter(Boolean);
      if (!deck.length) { renderHome(); return; }
      newSession(deck, "Работа над ошибками", "mistakes");
    }
    else return;
    renderQuiz();
  }

  function startIds(ids, title) {
    const deck = ids.map(id => BY_ID[id]).filter(Boolean);
    if (!deck.length) { renderHome(); return; }
    newSession(deck, title, "custom");
    renderQuiz();
  }

  function startLevel(level) {
    const isTest = level.kind === "test";
    const deck = isTest ? shuffle(level.tasks).slice(0, 20) : level.tasks.slice();
    newSession(deck, `Вариант ${level.variant === "v1" ? 1 : 2} · ${level.title}`, isTest ? "test" : "level");
    session.levelId = level.id;
    renderQuiz();
  }

  /* ================= ЭКРАН ЗАДАНИЯ ================= */
  function renderQuiz() {
    const t = session.deck[session.idx];
    const progress = pct(session.idx, session.deck.length);

    Q = {
      task: t, checked: false, correct: false, matched: {}, selectedLeft: null,
      seq: [], pool: [], selectedOption: null, revealed: false, rightOrder: []
    };
    if (t.type === "match") Q.rightOrder = shuffle(t.pairs.map((_, i) => i));
    if (t.type === "order") Q.pool = shuffle(t.items.map((_, i) => i));

    app.innerHTML = `
      <div class="quiz-shell">
        <header class="quiz-top">
          <button class="icon-btn close" id="exitBtn" aria-label="Выйти">✕</button>
          <div class="progress"><div class="progress-fill" style="width:${progress}%"></div></div>
          <div class="quiz-stats">
            <span class="streak" title="Серия верных ответов">🔥 <b id="streakVal">${session.streak}</b></span>
            <span class="xp-mini">⚡ <b id="xpVal">${session.xp}</b></span>
          </div>
        </header>

        <main class="quiz-main" data-task="${t.id}">
          <div class="quiz-meta">
            <div class="meta-left">
              <span class="tag">${session.exam ? "Итоговый тест" : t.section + " · " + (TYPE_LABEL[t.type] || "")}</span>
              ${session.exam ? '<span class="tag exam">Без подсказок</span>' : ""}
            </div>
            <span class="counter">${session.idx + 1} из ${session.deck.length}</span>
          </div>
          <h1 class="question">${esc(t.prompt)}</h1>
          <div id="interaction" class="interaction"></div>
        </main>

        <div class="actionbar" id="actionbar"></div>
      </div>`;

    document.getElementById("exitBtn").addEventListener("click", askExit);
    renderInteraction();
    updateActionBar();
  }

  function renderInteraction() {
    const box = document.getElementById("interaction");
    if (!box) return;
    const t = Q.task;

    if (t.type === "match") {
      box.innerHTML = matchHTML();
      bindMatch();
    } else if (t.type === "order") {
      box.innerHTML = orderHTML();
      bindOrder();
    } else if (t.type === "choice") {
      box.innerHTML = choiceHTML();
      bindChoice();
    } else if (t.type === "open") {
      box.innerHTML = openHTML();
      if (Q.revealed) {
        const zone = document.getElementById("answerZone");
        if (zone) zone.innerHTML = answerBoxHTML();
      }
    }
  }

  /* ---------- соответствие ---------- */
  function matchHTML() {
    const t = Q.task;
    const labels = MATCH_LABELS[t.id] || ["Слева", "Справа"];
    const leftMatchedRight = ri => Object.keys(Q.matched).find(k => Q.matched[k] === ri);
    const rightLetter = ri => LETTERS[Q.rightOrder.indexOf(ri)];
    const left = t.pairs.map((p, i) => {
      const paired = Q.matched[i] !== undefined;
      let cls = "match-item";
      if (paired) cls += " linked";
      if (Q.selectedLeft === i) cls += " selected";
      if (Q.checked) cls += (Q.matched[i] !== undefined && t.pairs[Q.matched[i]].r === p.r) ? " correct" : " wrong";
      return `<button class="${cls}" data-side="l" data-i="${i}" ${Q.checked ? "disabled" : ""}>
        <span class="tag-letter">${LETTERS[i]}</span>
        <span class="match-text">${esc(p.l)}</span>
        ${paired ? `<span class="badge">${rightLetter(Q.matched[i])}</span>` : ""}
      </button>`;
    }).join("");

    const right = Q.rightOrder.map((ri, pos) => {
      const owner = leftMatchedRight(ri);
      const paired = owner !== undefined;
      let cls = "match-item right";
      if (paired) cls += " linked";
      if (Q.checked) {
        const good = paired && t.pairs[owner].r === t.pairs[ri].r;
        cls += good ? " correct" : " wrong";
      }
      return `<button class="${cls}" data-side="r" data-i="${ri}" ${Q.checked ? "disabled" : ""}>
        <span class="tag-letter ${paired ? "blue" : ""}">${LETTERS[pos]}</span>
        <span class="match-text">${esc(t.pairs[ri].r)}</span>
      </button>`;
    }).join("");

    return `
      <div class="match-grid">
        <div class="match-col">
          <div class="match-label">${esc(labels[0])}</div>
          ${left}
        </div>
        <div class="match-col">
          <div class="match-label">${esc(labels[1])}</div>
          ${right}
        </div>
      </div>
      <div class="hint">Нажмите элемент слева, затем подходящий — справа. Повторное нажатие снимает пару.</div>`;
  }

  function bindMatch() {
    document.querySelectorAll(".match-item").forEach(btn => {
      btn.addEventListener("click", () => {
        if (Q.checked) return;
        const i = Number(btn.dataset.i);
        if (btn.dataset.side === "l") {
          if (Q.matched[i] !== undefined) {
            delete Q.matched[i];
            Q.selectedLeft = i;
          } else {
            Q.selectedLeft = (Q.selectedLeft === i) ? null : i;
          }
        } else {
          const owner = Object.keys(Q.matched).find(k => Q.matched[k] === i);
          if (owner !== undefined) {
            delete Q.matched[owner];
          } else if (Q.selectedLeft !== null) {
            Q.matched[Q.selectedLeft] = i;
            Q.selectedLeft = null;
          }
        }
        renderInteraction();
        updateActionBar();
      });
    });
  }

  /* ---------- последовательность ---------- */
  function orderHTML() {
    const t = Q.task;
    const slots = t.items.map((_, k) => {
      const idx = Q.seq[k];
      if (idx === undefined) {
        return `<div class="slot empty"><span class="num">${k + 1}</span><span class="slot-hint">перетащите сюда пункт</span></div>`;
      }
      let cls = "slot filled";
      if (Q.checked) cls += (idx === t.correct[k]) ? " correct" : " wrong";
      return `<button class="${cls}" data-slot="${k}" ${Q.checked ? "disabled" : ""}>
        <span class="num">${k + 1}</span>
        <span class="slot-text">${esc(t.items[idx])}</span>
        ${Q.checked ? `<span class="slot-ico">${idx === t.correct[k] ? "✓" : "✕"}</span>` : `<span class="slot-x">✕</span>`}
      </button>`;
    }).join("");

    const pool = Q.pool.filter(i => !Q.seq.includes(i)).map(i =>
      `<button class="chip" data-pool="${i}" ${Q.checked ? "disabled" : ""}>${esc(t.items[i])}</button>`
    ).join("");

    return `
      <div class="order-wrap">
        <div class="slots">${slots}</div>
        <div class="pool-label">Пункты для выбора</div>
        <div class="pool">${pool || '<span class="pool-done">Все пункты расставлены ✓</span>'}</div>
      </div>
      <div class="hint">Нажимайте пункты по порядку. Нажмите на пункт в ответе, чтобы вернуть его назад.</div>`;
  }

  function bindOrder() {
    document.querySelectorAll("[data-pool]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (Q.checked) return;
        Q.seq.push(Number(btn.dataset.pool));
        renderInteraction(); updateActionBar();
      });
    });
    document.querySelectorAll("[data-slot]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (Q.checked) return;
        Q.seq.splice(Number(btn.dataset.slot), 1);
        renderInteraction(); updateActionBar();
      });
    });
  }

  /* ---------- тест ---------- */
  function choiceHTML() {
    const t = Q.task;
    return `<div class="options">${t.options.map((o, i) => {
      let cls = "option";
      if (Q.selectedOption === i) cls += " selected";
      if (Q.checked) {
        if (i === t.correct) cls += " correct";
        else if (i === Q.selectedOption) cls += " wrong";
      }
      return `<button class="${cls}" data-opt="${i}" ${Q.checked ? "disabled" : ""}>
        <span class="key">${i + 1}</span>
        <span class="opt-text">${esc(o)}</span>
        ${Q.checked && i === t.correct ? '<span class="opt-ico">✓</span>' : ""}
      </button>`;
    }).join("")}</div>`;
  }

  function bindChoice() {
    document.querySelectorAll("[data-opt]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (Q.checked) return;
        Q.selectedOption = Number(btn.dataset.opt);
        renderInteraction(); updateActionBar();
      });
    });
  }

  /* ---------- открытый ответ ---------- */
  function openHTML() {
    return `
      <textarea class="notes" id="notes" placeholder="Черновик ответа (автоматически не проверяется)…"></textarea>
      <div class="hint">Сформулируйте ответ вслух или в черновике, затем откройте эталон и оцените себя честно.</div>
      <div id="answerZone"></div>`;
  }

  function answerBoxHTML() {
    const t = Q.task;
    return `
      <div class="answer-box">
        <div class="answer-label">Эталонный ответ</div>
        <div class="answer-text">${esc(t.answer)}</div>
        <div class="answer-label second">Почему так</div>
        <div class="answer-explain">${esc(t.explain)}</div>
      </div>`;
  }

  /* ---------- нижняя панель ---------- */
  function isReady() {
    const t = Q.task;
    if (t.type === "match") return Object.keys(Q.matched).length === t.pairs.length;
    if (t.type === "order") return Q.seq.length === t.items.length;
    if (t.type === "choice") return Q.selectedOption !== null;
    return false;
  }

  function updateActionBar() {
    const bar = document.getElementById("actionbar");
    if (!bar) return;
    if (Q.checked) { bar.innerHTML = ""; bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    const t = Q.task;

    if (t.type === "open") {
      if (!Q.revealed) {
        bar.innerHTML = `<button class="btn btn-primary" id="revealBtn">Показать ответ</button>`;
        document.getElementById("revealBtn").addEventListener("click", revealAnswer);
      } else {
        bar.innerHTML = `<div class="two-btns">
          <button class="btn btn-secondary" id="againBtn">Повторить</button>
          <button class="btn btn-primary" id="knewBtn">Знал!</button>
        </div>`;
        document.getElementById("againBtn").addEventListener("click", () => finish(false));
        document.getElementById("knewBtn").addEventListener("click", () => finish(true));
      }
      return;
    }

    const ready = isReady();
    bar.innerHTML = `<button class="btn btn-primary" id="checkBtn" ${ready ? "" : "disabled"}>Проверить</button>`;
    const b = document.getElementById("checkBtn");
    if (b) b.addEventListener("click", check);
  }

  function revealAnswer() {
    Q.revealed = true;
    renderInteraction();
    updateActionBar();
  }

  /* ---------- проверка ---------- */
  function check() {
    if (Q.checked || !isReady()) return;
    const t = Q.task;
    let ok = false;

    if (t.type === "match") {
      ok = Object.keys(Q.matched).every(i => t.pairs[Q.matched[i]].r === t.pairs[i].r);
    } else if (t.type === "order") {
      ok = Q.seq.every((v, k) => v === t.correct[k]);
    } else if (t.type === "choice") {
      ok = Q.selectedOption === t.correct;
    }

    Q.correct = ok;
    finish(ok);
  }

  /* ---------- фиксация результата ---------- */
  function finish(ok) {
    if (Q.checked) return;
    Q.checked = true;
    renderInteraction();
    const id = Q.task.id;

    session.answered++;
    store.attempts++;

    const prev = store.done[id] || { ok: false, tries: 0 };
    store.done[id] = { ok: ok ? true : (prev.ok || false), tries: prev.tries + 1, last: Date.now() };

    if (ok) {
      session.correct++;
      session.streak++;
      session.xp += 10;
      store.xp += 10;
      store.correctTotal++;
      store.mistakes = store.mistakes.filter(x => x !== id);
    } else {
      session.streak = 0;
      session.xp += 3;
      store.xp += 3;
      if (!store.mistakes.includes(id)) store.mistakes.push(id);
      if (!session.mistakes.includes(id)) session.mistakes.push(id);
    }

    session.bestStreak = Math.max(session.bestStreak, session.streak);
    store.bestStreak = Math.max(store.bestStreak, session.streak);
    saveStore();
    updateHeaderStats();
    beep(ok ? "ok" : "no");
    if (session.exam) showExamFeedback(ok);
    else showFeedback(ok);
  }

  function updateHeaderStats() {
    const sv = document.getElementById("streakVal");
    const xv = document.getElementById("xpVal");
    if (sv) sv.textContent = session.streak;
    if (xv) xv.textContent = session.xp;
  }

  /* ---------- плашка с объяснением ---------- */
  function correctAnswerHTML() {
    const t = Q.task;
    if (t.type === "match") {
      return `<div class="fb-block"><b>Правильные пары:</b><ul class="fb-list">${
        t.pairs.map(p => `<li><span>${esc(p.l)}</span><i>→</i><span>${esc(p.r)}</span></li>`).join("")
      }</ul></div>`;
    }
    if (t.type === "order") {
      return `<div class="fb-block"><b>Правильный порядок:</b><div class="fb-seq">${
        t.correct.map(i => esc(t.items[i])).join(' <span class="arr">→</span> ')
      }</div></div>`;
    }
    if (t.type === "choice") {
      return `<div class="fb-block"><b>Правильный ответ:</b> ${esc(t.options[t.correct])}</div>`;
    }
    return "";
  }

  function showFeedback(ok) {
    const t = Q.task;
    const titles = ok ? ["Отлично!", "Верно!", "Так держать!", "Супер!", "Точно в цель!"] : ["Почти!", "Не совсем", "Есть нюанс", "Запомним"];
    const title = titles[Math.floor(Math.random() * titles.length)];

    const el = document.createElement("div");
    el.className = "feedback " + (ok ? "good" : "bad");
    el.innerHTML = `
      <div class="feedback-inner">
        <div class="fb-top">
          <div class="fb-icon">${ok ? "✓" : "✕"}</div>
          <div class="fb-title">${title}</div>
          <div class="fb-xp">${ok ? "+10 XP" : "+3 XP"}</div>
        </div>
        ${ok ? "" : correctAnswerHTML()}
        <div class="fb-explain">${esc(t.explain)}</div>
        <button class="btn ${ok ? "btn-primary" : "btn-danger"}" id="nextBtn">Продолжить</button>
      </div>`;
    document.querySelector(".quiz-shell").appendChild(el);
    document.getElementById("nextBtn").addEventListener("click", nextTask);
    setTimeout(() => { const b = document.getElementById("nextBtn"); if (b) b.focus({ preventScroll: true }); }, 50);
  }

  /* ---------- плашка режима «Тест»: без ответов и объяснений ---------- */
  function showExamFeedback(ok) {
    const last = session.idx + 1 >= session.deck.length;
    const el = document.createElement("div");
    el.className = "feedback exam " + (ok ? "good" : "bad");
    el.innerHTML = `
      <div class="feedback-inner">
        <div class="fb-top">
          <div class="fb-icon">${ok ? "✓" : "✕"}</div>
          <div class="fb-title">${ok ? "Верно!" : "Ошибка"}</div>
          <div class="fb-xp">${ok ? "+10 XP" : "+3 XP"}</div>
        </div>
        <div class="fb-explain">${last ? "Это был последний вопрос. Сейчас покажем результат и разбор ошибок." : "Ответ принят. Подсказки и объяснения — только в разборе после теста."}</div>
        <button class="btn ${ok ? "btn-primary" : "btn-danger"}" id="nextBtn">${last ? "Результат" : "Дальше"}</button>
      </div>`;
    document.querySelector(".quiz-shell").appendChild(el);
    document.getElementById("nextBtn").addEventListener("click", nextTask);
    setTimeout(() => { const b = document.getElementById("nextBtn"); if (b) b.focus({ preventScroll: true }); }, 50);
  }

  function nextTask() {
    if (session.idx + 1 >= session.deck.length) {
      renderResult();
    } else {
      session.idx++;
      renderQuiz();
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }
  }

  /* ---------- выход ---------- */
  function askExit() {
    if (session.answered === 0) { renderHome(); return; }
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-emoji">🤔</div>
        <h3>Выйти из урока?</h3>
        <p>Ответы уже учтены в прогрессе, но урок будет завершён досрочно.</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="stayBtn">Остаться</button>
          <button class="btn btn-danger" id="leaveBtn">Выйти</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("stayBtn").addEventListener("click", () => overlay.remove());
    document.getElementById("leaveBtn").addEventListener("click", () => { overlay.remove(); renderHome(); });
  }

  /* ================= РЕЗУЛЬТАТ ================= */
  function answerSummary(t) {
    if (!t) return "";
    if (t.type === "match") {
      return t.pairs.map(p => `<b>${esc(p.l)}</b> — ${esc(p.r)}`).join("<br>");
    }
    if (t.type === "order") {
      return t.correct.map((i, k) => `${k + 1}. ${esc(t.items[i])}`).join("<br>");
    }
    if (t.type === "choice") {
      return esc(t.options[t.correct]);
    }
    return esc(t.answer || "");
  }

  function renderResult() {
    const total = session.deck.length;
    const acc = pct(session.correct, total);
    const mins = Math.max(1, Math.round((Date.now() - session.start) / 60000));
    const exam = session.mode === "test";
    const level = session.levelId ? LEVELS.find(l => l.id === session.levelId) : null;
    if (level) {
      store.levels = store.levels || {};
      store.levels[level.id] = Math.max(store.levels[level.id] || 0, acc);
      saveStore();
    }
    const levelIdx = level ? LEVELS.indexOf(level) : -1;
    const nextLevel = levelIdx >= 0 ? LEVELS[levelIdx + 1] : null;
    let emoji = exam ? "🎯" : "🏆", title = exam ? "Тест завершён" : level ? "Уровень пройден!" : "Урок пройден!";
    if (acc === 100) title = exam ? "Тест сдан на 100%!" : "Идеально!";
    else if (acc >= 90) title = exam ? "Тест сдан отлично!" : "Почти идеально!";
    else if (acc >= 70) title = exam ? "Тест пройден хорошо" : "Хороший результат!";
    else if (acc < 50) { emoji = "💪"; title = exam ? "Тест пока слабоват" : "Есть над чем поработать"; }

    app.innerHTML = `
      <div class="result-shell">
        <div class="confetti" id="confetti"></div>
        <div class="result-card">
          <div class="result-emoji">${emoji}</div>
          <h1>${title}</h1>
          <p class="result-sub">${esc(session.title)} · ${total} заданий за ${mins} мин</p>

          <div class="result-stats">
            <div class="rstat"><b>${acc}%</b><span>точность</span></div>
            <div class="rstat"><b>+${session.xp}</b><span>XP за ${exam ? "тест" : "урок"}</span></div>
            <div class="rstat"><b>${session.bestStreak}</b><span>лучшая серия</span></div>
            <div class="rstat"><b>${session.mistakes.length}</b><span>на повтор</span></div>
          </div>

          ${session.mistakes.length
            ? `<p class="result-note">${exam ? "Разбор ошибок — ниже. Эти задания добавлены в «Повторить ошибки»." : level ? "Уровень засчитан. Лучший результат: " + store.levels[level.id] + "%." : "Задания на повтор: " + session.mistakes.length + ". Их можно пройти отдельным коротким уроком."}</p>`
            : `<p class="result-note">${level ? "Уровень засчитан на " + store.levels[level.id] + "%. Следующий уже открыт." : "Ошибок нет — можно двигаться дальше."}</p>`}

          ${exam && session.mistakes.length ? `
          <div class="review-block">
            <div class="review-head">Разбор ошибок</div>
            ${session.mistakes.map(id => {
              const t = BY_ID[id];
              if (!t) return "";
              return `<div class="review-item">
                <div class="review-q">${esc(t.prompt)}</div>
                <div class="review-a">${answerSummary(t)}</div>
                <div class="review-e">${esc(t.explain || "")}</div>
              </div>`;
            }).join("")}
          </div>` : ""}

          <div class="result-actions">
            ${nextLevel ? `<button class="btn btn-primary" id="nextLevel">Следующий уровень →</button>` : ""}
            ${session.mistakes.length ? `<button class="btn ${nextLevel ? "btn-secondary" : "btn-primary"}" id="retryMistakes">Повторить ошибки (${session.mistakes.length})</button>` : ""}
            <button class="btn btn-secondary" id="againAll">Пройти ещё раз</button>
            <button class="btn btn-ghost" id="toHome">На главную</button>
          </div>
        </div>
      </div>`;

    if (acc >= 70) confetti();
    document.getElementById("toHome").addEventListener("click", renderHome);
    document.getElementById("againAll").addEventListener("click", () => {
      if (level) startLevel(level);
      else startMode(session.mode === "custom" ? "all" : session.mode);
    });
    const nl = document.getElementById("nextLevel");
    if (nl) nl.addEventListener("click", () => startLevel(nextLevel));
    const rm = document.getElementById("retryMistakes");
    if (rm) rm.addEventListener("click", () => startIds(session.mistakes.slice(), "Работа над ошибками"));
  }

  function confetti() {
    const box = document.getElementById("confetti");
    if (!box) return;
    const colors = ["#58cc02", "#1cb0f6", "#ffc800", "#ff4b4b", "#ce82ff", "#ff9600"];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = (Math.random() * 1.2) + "s";
      p.style.animationDuration = (2.2 + Math.random() * 1.6) + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      p.style.width = (6 + Math.random() * 7) + "px";
      p.style.height = (10 + Math.random() * 10) + "px";
      box.appendChild(p);
    }
    setTimeout(() => { box.innerHTML = ""; }, 5000);
  }

  /* ================= КЛАВИАТУРА ================= */
  document.addEventListener("keydown", e => {
    if (!Q || !document.querySelector(".quiz-shell")) return;

    if (e.key === "Enter") {
      const next = document.querySelector(".feedback #nextBtn");
      if (next) { e.preventDefault(); next.click(); return; }
      const reveal = document.getElementById("revealBtn");
      if (reveal) { e.preventDefault(); reveal.click(); return; }
      const cb = document.getElementById("checkBtn");
      if (cb && !cb.disabled) { e.preventDefault(); cb.click(); }
      return;
    }

    if (Q.task.type === "choice" && !Q.checked) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= Q.task.options.length) {
        Q.selectedOption = n - 1;
        renderInteraction();
        updateActionBar();
      }
    }
  });

  /* ================= СТАРТ ================= */
  renderHome();
})();
