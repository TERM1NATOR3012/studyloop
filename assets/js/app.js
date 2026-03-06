import { StudyLoopDB } from "./db.js";
import { isoToday, addDays, parseDaysCSV, nextWorkDay, scheduleRevisions, distributeDates } from "./scheduler.js";

const THEMES = ["Apple Light","Apple Dark","Neon Dark","Pastel Dream","Cyber Night","Glass Gradient","Slate Ember"];
const FONT_SUGGESTIONS = [
  "Inter","-apple-system","Segoe UI","Roboto","Poppins","Montserrat","JetBrains Mono","Consolas","Arial"
];

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function pill(text, color) {
  return `<span class="pill" style="background:${color}">${escapeHtml(text)}</span>`;
}
function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function showModal({ title, body, onSubmit, submitText="Save" }) {
  const host = $("#modalHost");
  host.classList.remove("hidden");
  host.setAttribute("aria-hidden","false");
  host.innerHTML = "";

  const modal = el(`
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modalHeader">
        <div class="modalTitle">${escapeHtml(title)}</div>
        <button class="btn btnGhost" data-close>Close</button>
      </div>
      <form class="modalBody" data-form>
        ${body}
        <div class="modalFooter">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btnPrimary">${escapeHtml(submitText)}</button>
        </div>
      </form>
    </div>
  `);

  host.appendChild(modal);

  const close = () => {
    host.classList.add("hidden");
    host.setAttribute("aria-hidden","true");
    host.innerHTML = "";
  };

  $$("[data-close]", host).forEach(b => b.addEventListener("click", close));
  host.addEventListener("click", (e) => { if (e.target === host) close(); }, { once:true });

  const form = $("[data-form]", host);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (onSubmit) {
      const ok = await onSubmit(new FormData(form));
      if (ok !== false) close();
    } else {
      close();
    }
  });
}

function toast(msg) {
  // minimal
  alert(msg);
}

/* ---------- App State ---------- */
let db;

async function loadAppearance() {
  const theme = (await db.getSetting("theme")) || "Apple Light";
  const font = (await db.getSetting("font_family")) || "Inter";
  const size = (await db.getSetting("font_size")) || "13";
  applyAppearance({ theme, font, size });
}

function applyAppearance({ theme, font, size }) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--font-family", font);
  document.documentElement.style.setProperty("--font-size", `${parseInt(size,10)||13}px`);
}

/* ---------- Service worker updates ---------- */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          $("#updateBanner").classList.remove("hidden");
        }
      });
    });

    $("#reloadBtn").addEventListener("click", () => location.reload());
  }catch(e){
    // ignore
  }
}

/* ---------- Navigation ---------- */
function setPage(pageName) {
  $$(".navItem").forEach(b => b.classList.toggle("isActive", b.dataset.page === pageName));
  $$(".page").forEach(p => p.classList.remove("isVisible"));
  $(`#page-${pageName}`).classList.add("isVisible");
  render(pageName);
}

$$(".navItem").forEach(b => b.addEventListener("click", () => setPage(b.dataset.page)));

/* ---------- Helpers: join topic + subject ---------- */
async function subjectsMap() {
  const subs = await db.listSubjects();
  const m = new Map();
  for (const s of subs) m.set(s.id, s);
  return m;
}

/* ---------- Carry-forward (ask every time) ---------- */
async function checkCarryForward() {
  const last = await db.getSetting("last_opened");
  const today = isoToday();
  await db.setSetting("last_opened", today);

  if (!last || last >= today) return;

  const lastDate = last;
  const yesterday = addDays(today, -1);
  if (lastDate >= yesterday) return;

  const from = addDays(lastDate, 1);
  const missed = await db.pendingRevisionsInRange(from, yesterday);
  if (!missed.length) return;

  showModal({
    title: "Missed revisions",
    submitText: "Apply",
    body: `
      <div class="card" style="box-shadow:none">
        <div class="rowBetween">
          <div>
            <div class="itemTitle">${missed.length} pending revision(s)</div>
            <div class="itemMeta">From ${from} to ${yesterday}</div>
          </div>
        </div>
        <hr class="sep">
        <label class="itemMeta" style="font-weight:900">Choose:</label>
        <div class="row" style="flex-wrap:wrap">
          <label class="row"><input type="radio" name="mode" value="all" checked> Load all today</label>
          <label class="row"><input type="radio" name="mode" value="spread"> Spread over</label>
          <input class="input" style="max-width:120px" name="spreadDays" type="number" min="2" max="30" value="7">
          <div class="itemMeta">days</div>
        </div>
      </div>
    `,
    onSubmit: async (fd) => {
      const mode = fd.get("mode");
      const spreadDays = parseInt(fd.get("spreadDays"),10) || 7;

      const holidays = new Set((await db.listHolidays()).map(h => h.date));
      const weeklyOff = new Set(((await db.getSetting("weekly_holidays"))||"")
        .split(",").map(x=>parseInt(x,10)).filter(n=>Number.isFinite(n)));

      const todayWork = nextWorkDay(today, holidays, weeklyOff);
      if (mode === "all") {
        for (const r of missed) {
          r.scheduledDate = todayWork;
          await db.updateRevision(r);
        }
      } else {
        const dates = distributeDates(today, missed.length, spreadDays).map(d => nextWorkDay(d, holidays, weeklyOff));
        for (let i=0;i<missed.length;i++){
          missed[i].scheduledDate = dates[i];
          await db.updateRevision(missed[i]);
        }
      }

      await render("today");
    }
  });
}

/* ---------- Render dispatcher ---------- */
async function render(pageName) {
  switch(pageName){
    case "today": return renderToday();
    case "calendar": return renderCalendar();
    case "upcoming": return renderUpcoming();
    case "topics": return renderTopics();
    case "homework": return renderHomework();
    case "subjects": return renderSubjects();
    case "dashboard": return renderDashboard();
    case "settings": return renderSettings();
  }
}

/* ---------- TODAY ---------- */
async function renderToday() {
  const host = $("#page-today");
  const today = isoToday();
  const subs = await subjectsMap();

  const revs = await db.listRevisionsByDate(today);
  const pending = revs.filter(r=>r.status==="pending");
  const done = revs.filter(r=>r.status==="done");
  const skipped = revs.filter(r=>r.status==="skipped");

  // homework: today + overdue
  const hwToday = (await db.listHomeworkByDate(today)).filter(h=>h.status==="pending");
  const allPendingHw = await db.listHomework({ status: "pending" });
  const overdue = allPendingHw.filter(h => h.dueDate < today);

  host.innerHTML = `
    <h1 class="pageTitle">Today</h1>
    <p class="pageSub">${new Date().toLocaleDateString(undefined,{ weekday:"long", year:"numeric", month:"long", day:"numeric" })}</p>

    <div class="row" style="gap:10px; margin-bottom: 12px">
      <button class="btn btnPrimary" id="btnAddTopic">Add Topic</button>
      <button class="btn btnPrimary" id="btnAddHW">Add Homework</button>
    </div>

    <div class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Revisions Due</div>
          <div class="itemMeta">${pending.length} pending • ${done.length} done • ${skipped.length} skipped</div>
        </div>
      </div>
      <div class="list" id="todayRevList"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Homework</div>
          <div class="itemMeta">${hwToday.length} due today • ${overdue.length} overdue</div>
        </div>
      </div>
      <div class="list" id="todayHWList"></div>
    </div>
  `;

  $("#btnAddTopic").addEventListener("click", () => openTopicModal());
  $("#btnAddHW").addEventListener("click", () => openHomeworkModal());

  // revisions list
  const list = $("#todayRevList");
  if (!revs.length) {
    list.appendChild(el(`<div class="muted" style="font-weight:800">No revisions due today.</div>`));
  } else {
    for (const r of revs) {
      const topic = await db.getTopic(r.topicId);
      const subj = subs.get(topic.subjectId);
      const statusText = r.status.toUpperCase();
      const item = el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(topic?.name || "Topic")}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} (Day ${r.dayInterval}) • ${statusText}</div>
            </div>
          </div>
          <div class="row">
            ${r.status==="pending" ? `
              <button class="btn btnPrimary" data-done="${r.id}">Done</button>
              <button class="btn" data-skip="${r.id}">Skip</button>
            ` : r.status==="done" ? `
              <button class="btn" data-undo="${r.id}">Mark Undone</button>
            ` : `
              <button class="btn" data-undo="${r.id}">Mark Undone</button>
            `}
          </div>
        </div>
      `);
      list.appendChild(item);
    }
  }

  // actions
  $$("[data-done]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.done,10);
    const r = await db.getRevision(id);
    r.status = "done";
    await db.updateRevision(r);
    await renderToday();
  }));
  $$("[data-skip]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.skip,10);
    const r = await db.getRevision(id);
    r.status = "skipped";
    await db.updateRevision(r);
    await renderToday();
  }));
  $$("[data-undo]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.undo,10);
    const r = await db.getRevision(id);
    r.status = "pending";
    await db.updateRevision(r);
    await renderToday();
  }));

  // homework list
  const hwList = $("#todayHWList");

  const renderHWItem = async (h, {overdue=false}={}) => {
    const subj = subs.get(h.subjectId);
    const cls = overdue ? "item overdue" : "item";
    const item = el(`
      <div class="${cls}">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(h.title)}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Due ${h.dueDate} • Priority ${h.priority.toUpperCase()}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn btnPrimary" data-hwdone="${h.id}">Complete</button>
          <button class="btn" data-hwedit="${h.id}">Edit</button>
          <button class="btn btnDanger" data-hwdel="${h.id}">Delete</button>
        </div>
      </div>
    `);
    hwList.appendChild(item);
  };

  if (!hwToday.length && !overdue.length) {
    hwList.appendChild(el(`<div class="muted" style="font-weight:800">No homework due today.</div>`));
  } else {
    for (const h of overdue) await renderHWItem(h, {overdue:true});
    for (const h of hwToday) await renderHWItem(h);
  }

  $$("[data-hwdone]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.hwdone,10);
    const h = await db.getHomework(id);
    h.status = "completed";
    await db.updateHomework(h);
    await renderToday();
  }));
  $$("[data-hwedit]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.hwedit,10);
    const h = await db.getHomework(id);
    openHomeworkModal(h);
  }));
  $$("[data-hwdel]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.hwdel,10);
    if (!confirm("Delete this homework?")) return;
    await db.deleteHomework(id);
    await renderToday();
  }));

  // streak day log: completed if no pending revisions today
  await db.logDay(today, pending.length === 0);
}

/* ---------- CALENDAR ---------- */
function monthInfo(year, month1to12) {
  const first = new Date(Date.UTC(year, month1to12-1, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return { startDow, daysInMonth };
}

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1;
let calSelected = isoToday();

async function renderCalendar() {
  const host = $("#page-calendar");
  const { startDow, daysInMonth } = monthInfo(calYear, calMonth);

  const allRev = await db.revisionsInRange(`${calYear}-${String(calMonth).padStart(2,"0")}-01`, `${calYear}-${String(calMonth).padStart(2,"0")}-31`);
  const allHw = await db.listHomework();
  const revCount = new Map();
  const hwCount = new Map();

  for (const r of allRev) {
    if (r.status !== "pending") continue;
    revCount.set(r.scheduledDate, (revCount.get(r.scheduledDate)||0) + 1);
  }
  for (const h of allHw) {
    if (h.status !== "pending") continue;
    if (h.dueDate.slice(0,7) !== `${calYear}-${String(calMonth).padStart(2,"0")}`) continue;
    hwCount.set(h.dueDate, (hwCount.get(h.dueDate)||0) + 1);
  }

  const monthName = new Date(Date.UTC(calYear, calMonth-1, 1)).toLocaleDateString(undefined, { month:"long", year:"numeric" });

  host.innerHTML = `
    <h1 class="pageTitle">Calendar</h1>
    <p class="pageSub">Click a date to view scheduled items.</p>

    <div class="card">
      <div class="rowBetween">
        <div class="row" style="gap:10px">
          <button class="btn" id="calPrev">Previous</button>
          <button class="btn" id="calNext">Next</button>
        </div>
        <div style="font-weight:950">${escapeHtml(monthName)}</div>
        <div class="muted" style="font-weight:800">R = revisions • H = homework</div>
      </div>

      <hr class="sep">

      <div class="calendarGrid" style="margin-bottom:10px">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="calDow">${d}</div>`).join("")}
      </div>

      <div class="calendarGrid" id="calGrid"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Selected: <span id="calSel">${calSelected}</span></div>
          <div class="itemMeta" id="calSelMeta"></div>
        </div>
      </div>
      <div class="list" id="calDetailList"></div>
    </div>
  `;

  $("#calPrev").addEventListener("click", () => {
    calMonth -= 1;
    if (calMonth === 0){ calMonth = 12; calYear -= 1; }
    renderCalendar();
  });
  $("#calNext").addEventListener("click", () => {
    calMonth += 1;
    if (calMonth === 13){ calMonth = 1; calYear += 1; }
    renderCalendar();
  });

  const grid = $("#calGrid");

  // 42 cells
  const cells = [];
  for (let i=0;i<42;i++){
    const day = i - startDow + 1;
    if (day < 1 || day > daysInMonth) {
      cells.push({ empty:true });
    } else {
      const iso = `${calYear}-${String(calMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      cells.push({
        empty:false,
        day,
        iso,
        r: revCount.get(iso)||0,
        h: hwCount.get(iso)||0
      });
    }
  }

  for (const c of cells) {
    if (c.empty) {
      grid.appendChild(el(`<div style="min-height:72px"></div>`));
      continue;
    }
    const selected = c.iso === calSelected;
    const cell = el(`
      <div class="calCell ${selected ? "isSelected":""}" data-date="${c.iso}">
        <div class="calDay">${c.day}</div>
        <div class="calCounts">${(c.r||c.h) ? `${c.r ? `${c.r}R` : ""} ${c.h ? `${c.h}H` : ""}`.trim() : ""}</div>
      </div>
    `);
    cell.addEventListener("click", () => {
      calSelected = c.iso;
      renderCalendar();
    });
    grid.appendChild(cell);
  }

  await renderCalendarDetails(calSelected);
}

async function renderCalendarDetails(dateISO) {
  $("#calSel").textContent = dateISO;
  const subs = await subjectsMap();
  const revs = await db.listRevisionsByDate(dateISO);
  const hws = await db.listHomeworkByDate(dateISO);

  $("#calSelMeta").textContent = `${revs.length} revision(s), ${hws.length} homework item(s)`;

  const list = $("#calDetailList");
  list.innerHTML = "";

  if (!revs.length && !hws.length) {
    list.appendChild(el(`<div class="muted" style="font-weight:800">Nothing scheduled.</div>`));
    return;
  }

  for (const r of revs) {
    const tp = await db.getTopic(r.topicId);
    const subj = subs.get(tp.subjectId);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(tp?.name || "Topic")}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} (Day ${r.dayInterval}) • ${r.status.toUpperCase()}</div>
          </div>
        </div>
        <div class="row">
          ${r.status==="pending" ? `<span class="pill pillGrey">Pending</span>` : r.status==="done" ? `<span class="pill" style="background:var(--success)">Done</span>` : `<span class="pill" style="background:var(--warning);color:#111">Skipped</span>`}
        </div>
      </div>
    `));
  }

  for (const h of hws) {
    const subj = subs.get(h.subjectId);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(h.title)}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Priority ${h.priority.toUpperCase()} • ${h.status.toUpperCase()}</div>
          </div>
        </div>
      </div>
    `));
  }
}

/* ---------- UPCOMING ---------- */
async function renderUpcoming() {
  const host = $("#page-upcoming");
  const today = isoToday();
  const subs = await subjectsMap();

  host.innerHTML = `
    <h1 class="pageTitle">Upcoming</h1>
    <p class="pageSub">Next 7 days (pending only).</p>
    <div class="list" id="upList"></div>
  `;

  const list = $("#upList");
  for (let i=0;i<7;i++){
    const d = addDays(today, i);
    const revs = await db.listPendingRevisionsByDate(d);
    const hws = (await db.listHomeworkByDate(d)).filter(h=>h.status==="pending");

    const header = el(`<div class="card"><div class="rowBetween"><div style="font-weight:950">${d}</div><div class="muted" style="font-weight:850">${revs.length} revisions • ${hws.length} homework</div></div></div>`);
    header.style.boxShadow = "none";
    list.appendChild(header);

    if (!revs.length && !hws.length) {
      list.appendChild(el(`<div class="muted" style="padding:0 12px 12px 12px;font-weight:800">Nothing scheduled.</div>`));
      continue;
    }

    for (const r of revs) {
      const tp = await db.getTopic(r.topicId);
      const subj = subs.get(tp.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp?.name || "Topic")}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} (Day ${r.dayInterval})</div>
            </div>
          </div>
        </div>
      `));
    }

    for (const h of hws) {
      const subj = subs.get(h.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(h.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Priority ${h.priority.toUpperCase()}</div>
            </div>
          </div>
        </div>
      `));
    }
  }
}

/* ---------- TOPICS (search + filter, edit/delete, revisions modal) ---------- */
async function renderTopics() {
  const host = $("#page-topics");
  const subs = await db.listSubjects();

  host.innerHTML = `
    <h1 class="pageTitle">Topics</h1>
    <p class="pageSub">Search and filter by subject.</p>

    <div class="card">
      <div class="row" style="gap:10px; flex-wrap:wrap">
        <input id="tpSearch" class="input" style="max-width:340px" placeholder="Search topics">
        <select id="tpSubj" style="max-width:240px"></select>
        <button class="btn btnPrimary" id="tpAdd">Add Topic</button>
      </div>
      <hr class="sep">
      <div class="list" id="tpList"></div>
    </div>
  `;

  const subjSel = $("#tpSubj");
  subjSel.appendChild(el(`<option value="">All subjects</option>`));
  for (const s of subs) subjSel.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`));

  $("#tpAdd").addEventListener("click", () => openTopicModal());
  $("#tpSearch").addEventListener("input", () => renderTopicList());
  $("#tpSubj").addEventListener("change", () => renderTopicList());

  async function renderTopicList() {
    const search = $("#tpSearch").value.trim() || null;
    const sid = $("#tpSubj").value ? parseInt($("#tpSubj").value,10) : null;
    const topics = await db.listTopics({ subjectId: sid, search });
    const m = new Map(subs.map(s => [s.id, s]));
    const list = $("#tpList");
    list.innerHTML = "";

    if (!topics.length) {
      list.appendChild(el(`<div class="muted" style="font-weight:800">No topics found.</div>`));
      return;
    }

    for (const tp of topics) {
      const subj = m.get(tp.subjectId);
      const revs = await db.listRevisionsByTopic(tp.id);
      const done = revs.filter(r=>r.status==="done").length;
      const total = revs.length;

      const item = el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp.name)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Added ${tp.dateAdded} • ${done}/${total} done</div>
            </div>
          </div>
          <div class="row">
            <button class="btn" data-revs="${tp.id}">Revisions</button>
            <button class="btn" data-edit="${tp.id}">Edit</button>
            <button class="btn btnDanger" data-del="${tp.id}">Delete</button>
          </div>
        </div>
      `);
      list.appendChild(item);
    }

    $$("[data-edit]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.edit,10);
      const tp = await db.getTopic(id);
      openTopicModal(tp);
    }));

    $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.del,10);
      const tp = await db.getTopic(id);
      if (!confirm(`Delete "${tp.name}" and its revisions?`)) return;
      await db.deleteTopic(id);
      renderTopics();
    }));

    $$("[data-revs]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.revs,10);
      openTopicRevisionsModal(id);
    }));
  }

  renderTopicList();
}

/* ---------- HOMEWORK ---------- */
async function renderHomework() {
  const host = $("#page-homework");
  const subs = await db.listSubjects();
  const subsM = new Map(subs.map(s=>[s.id,s]));
  const today = isoToday();

  host.innerHTML = `
    <h1 class="pageTitle">Homework</h1>
    <p class="pageSub">Track due dates, priorities, overdue items.</p>

    <div class="card">
      <div class="row" style="gap:10px; flex-wrap:wrap">
        <select id="hwSubj" style="max-width:240px"></select>
        <select id="hwStatus" style="max-width:220px">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
        </select>
        <button class="btn btnPrimary" id="hwAdd">Add Homework</button>
      </div>
      <hr class="sep">
      <div class="list" id="hwList"></div>
    </div>
  `;

  const subjSel = $("#hwSubj");
  subjSel.appendChild(el(`<option value="">All subjects</option>`));
  for (const s of subs) subjSel.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`));

  $("#hwAdd").addEventListener("click", () => openHomeworkModal());
  $("#hwSubj").addEventListener("change", () => renderHWList());
  $("#hwStatus").addEventListener("change", () => renderHWList());

  async function renderHWList() {
    const sid = $("#hwSubj").value ? parseInt($("#hwSubj").value,10) : null;
    const st = $("#hwStatus").value || null;
    const hws = await db.listHomework({ subjectId: sid, status: st });

    const list = $("#hwList");
    list.innerHTML = "";

    if (!hws.length) {
      list.appendChild(el(`<div class="muted" style="font-weight:800">No homework found.</div>`));
      return;
    }

    for (const h of hws) {
      const subj = subsM.get(h.subjectId);
      const overdue = h.status==="pending" && h.dueDate < today;
      const item = el(`
        <div class="item ${overdue ? "overdue":""}">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(h.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Due ${h.dueDate} • Priority ${h.priority.toUpperCase()} • ${h.status.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            ${h.status==="pending"
              ? `<button class="btn btnPrimary" data-complete="${h.id}">Complete</button>`
              : `<button class="btn" data-uncomplete="${h.id}">Mark Pending</button>`}
            <button class="btn" data-edit="${h.id}">Edit</button>
            <button class="btn btnDanger" data-del="${h.id}">Delete</button>
          </div>
        </div>
      `);
      list.appendChild(item);

      if (h.description) {
        const d = el(`<div class="muted" style="padding:0 12px 10px 12px; font-weight:650">${escapeHtml(h.description)}</div>`);
        list.appendChild(d);
      }
    }

    $$("[data-complete]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.complete,10);
      const h = await db.getHomework(id);
      h.status = "completed";
      await db.updateHomework(h);
      renderHWList();
    }));
    $$("[data-uncomplete]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.uncomplete,10);
      const h = await db.getHomework(id);
      h.status = "pending";
      await db.updateHomework(h);
      renderHWList();
    }));
    $$("[data-edit]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.edit,10);
      const h = await db.getHomework(id);
      openHomeworkModal(h);
    }));
    $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.del,10);
      if (!confirm("Delete this homework?")) return;
      await db.deleteHomework(id);
      renderHWList();
    }));
  }

  renderHWList();
}

/* ---------- SUBJECTS ---------- */
async function renderSubjects() {
  const host = $("#page-subjects");
  const subjects = await db.listSubjects();

  host.innerHTML = `
    <h1 class="pageTitle">Subjects</h1>
    <p class="pageSub">Color-code and optionally customize revision days per subject.</p>

    <div class="row" style="gap:10px; margin-bottom: 12px">
      <button class="btn btnPrimary" id="subAdd">Add Subject</button>
    </div>

    <div class="card">
      <div class="list" id="subList"></div>
    </div>
  `;

  $("#subAdd").addEventListener("click", () => openSubjectModal());

  const list = $("#subList");
  list.innerHTML = "";

  if (!subjects.length) {
    list.appendChild(el(`<div class="muted" style="font-weight:800">No subjects yet.</div>`));
    return;
  }

  for (const s of subjects) {
    const days = s.revisionDays && s.revisionDays.length ? s.revisionDays.join(",") : "";
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${s.color}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(s.name)}</div>
            <div class="itemMeta">${days ? `Custom days: ${escapeHtml(days)}` : "Uses global revision days"}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-edit="${s.id}">Edit</button>
          <button class="btn btnDanger" data-del="${s.id}">Delete</button>
        </div>
      </div>
    `));
  }

  $$("[data-edit]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.edit,10);
    const s = await db.getSubject(id);
    openSubjectModal(s);
  }));
  $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.del,10);
    const s = await db.getSubject(id);
    if (!confirm(`Delete "${s.name}" and ALL its topics/revisions/homework?`)) return;
    await db.deleteSubject(id);
    renderSubjects();
  }));
}

/* ---------- DASHBOARD (includes "Month works" via segmented control) ---------- */
async function renderDashboard() {
  const host = $("#page-dashboard");
  host.innerHTML = `
    <h1 class="pageTitle">Dashboard</h1>
    <p class="pageSub">Weekly/Monthly stats, completion rate, streak.</p>

    <div class="rowBetween" style="margin-bottom: 12px">
      <div class="segment">
        <button class="segBtn" id="segWeek" aria-pressed="true">Week</button>
        <button class="segBtn" id="segMonth" aria-pressed="false">Month</button>
      </div>
      <div class="muted" style="font-weight:850">“Month” is fixed here (it now works).</div>
    </div>

    <div class="grid4" id="dashCards"></div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div>
          <div class="cardTitle" id="dashChartTitle">Revisions (This Week)</div>
          <div class="itemMeta" id="dashChartMeta"></div>
        </div>
      </div>
      <div id="dashChart"></div>
    </div>
  `;

  let mode = "week";
  const setSeg = (m) => {
    mode = m;
    $("#segWeek").setAttribute("aria-pressed", m==="week" ? "true":"false");
    $("#segMonth").setAttribute("aria-pressed", m==="month" ? "true":"false");
    renderDashContent(mode);
  };

  $("#segWeek").addEventListener("click", () => setSeg("week"));
  $("#segMonth").addEventListener("click", () => setSeg("month"));

  await renderDashContent(mode);
}

async function renderDashContent(mode) {
  const today = isoToday();
  const start = (mode==="week")
    ? addDays(today, -((new Date(today+"T00:00:00").getDay()+6)%7)) // monday
    : `${today.slice(0,8)}01`;

  const topics = await db.listTopics();
  const topicsAdded = topics.filter(t => t.dateAdded >= start && t.dateAdded <= today).length;

  const revs = await db.revisionsInRange(start, today);
  const total = revs.length;
  const done = revs.filter(r=>r.status==="done").length;
  const skipped = revs.filter(r=>r.status==="skipped").length;
  const rate = total ? Math.round((done/total)*1000)/10 : 0;

  // streak
  let streak = 0;
  let d = today;
  while (true) {
    const log = await db.getDailyLog(d);
    if (log && log.allCompleted) { streak += 1; d = addDays(d, -1); }
    else break;
  }

  const cards = $("#dashCards");
  cards.innerHTML = "";
  const card = (title, value) => el(`
    <div class="card" style="box-shadow: var(--shadow2)">
      <div class="muted" style="font-weight:900">${escapeHtml(title)}</div>
      <div style="font-size:28px;font-weight:950;margin-top:4px">${escapeHtml(value)}</div>
    </div>
  `);
  cards.appendChild(card("Topics studied", String(topicsAdded)));
  cards.appendChild(card("Revisions done", `${done}/${total}`));
  cards.appendChild(card("Completion rate", `${rate}%`));
  cards.appendChild(card("Streak", `${streak} days`));

  // chart data
  $("#dashChartTitle").textContent = mode==="week" ? "Revisions (This Week)" : "Revisions (This Month)";
  $("#dashChartMeta").textContent = `${total} total • ${done} done • ${skipped} skipped`;

  const days = [];
  if (mode === "week") {
    for (let i=0;i<7;i++) {
      const dt = addDays(start, i);
      days.push(dt);
    }
  } else {
    const endDay = parseInt(today.slice(8,10),10);
    for (let i=1;i<=endDay;i++){
      days.push(`${today.slice(0,8)}${String(i).padStart(2,"0")}`);
    }
  }

  const counts = new Map();
  const countsDone = new Map();
  for (const r of revs) {
    counts.set(r.scheduledDate, (counts.get(r.scheduledDate)||0) + 1);
    if (r.status==="done") countsDone.set(r.scheduledDate, (countsDone.get(r.scheduledDate)||0) + 1);
  }

  const max = Math.max(1, ...days.map(d=>counts.get(d)||0));
  const chart = el(`<div class="row" style="align-items:flex-end; gap:10px; overflow:auto; padding-bottom:6px"></div>`);

  for (const d of days) {
    const tot = counts.get(d)||0;
    const dn = countsDone.get(d)||0;
    const h = tot ? Math.round((tot/max)*140) : 4;
    const h2 = dn ? Math.round((dn/max)*140) : 0;
    const label = mode==="week"
      ? new Date(d+"T00:00:00").toLocaleDateString(undefined,{ weekday:"short" })
      : String(parseInt(d.slice(8,10),10));

    const bar = el(`
      <div style="min-width:34px; text-align:center">
        <div style="height:150px; display:flex; align-items:flex-end; justify-content:center">
          <div style="width:18px; height:${h}px; border-radius:10px; background: rgba(127,127,127,.35); position:relative; overflow:hidden">
            <div style="position:absolute; bottom:0; left:0; right:0; height:${h2}px; background: var(--primary); border-radius:10px"></div>
          </div>
        </div>
        <div class="muted" style="font-weight:900; font-size:12px">${label}</div>
      </div>
    `);
    chart.appendChild(bar);
  }

  const host = $("#dashChart");
  host.innerHTML = "";
  host.appendChild(chart);
}

/* ---------- SETTINGS (themes + fonts + revision days + holidays + exports) ---------- */
async function renderSettings() {
  const host = $("#page-settings");
  const theme = (await db.getSetting("theme")) || "Apple Light";
  const font = (await db.getSetting("font_family")) || "Inter";
  const size = (await db.getSetting("font_size")) || "13";
  const globalDays = (await db.getSetting("global_revision_days")) || "3,7,14,28";
  const weekly = (await db.getSetting("weekly_holidays")) || "";
  const weeklySet = new Set(weekly.split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));
  const holidays = await db.listHolidays();

  host.innerHTML = `
    <h1 class="pageTitle">Settings</h1>
    <p class="pageSub">Apple-like themes, fonts, revision rules, holidays, exports.</p>

    <div class="grid2">
      <div class="card">
        <div class="cardTitle">Appearance</div>
        <div class="row" style="margin-top:10px">
          <div style="flex:1">
            <div class="muted" style="font-weight:900">Theme</div>
            <select id="setTheme"></select>
          </div>
          <div style="flex:1">
            <div class="muted" style="font-weight:900">Font size (Sonoma feel = 13)</div>
            <input id="setSize" class="input" type="number" min="10" max="22" value="${escapeHtml(size)}">
          </div>
        </div>

        <div style="margin-top:10px">
          <div class="muted" style="font-weight:900">Font family</div>
          <input id="setFont" class="input" list="fontList" value="${escapeHtml(font)}" placeholder="Inter">
          <datalist id="fontList">
            ${FONT_SUGGESTIONS.map(f=>`<option value="${escapeHtml(f)}"></option>`).join("")}
          </datalist>
          <div class="itemMeta" style="margin-top:8px">Best Apple feel: install “Inter” and use size 13.</div>
        </div>

        <div class="row" style="margin-top:12px">
          <button class="btn btnPrimary" id="saveAppearance">Save</button>
        </div>
      </div>

      <div class="card">
        <div class="cardTitle">Revision Settings</div>
        <div style="margin-top:10px">
          <div class="muted" style="font-weight:900">Global revision days (comma-separated)</div>
          <input id="setDays" class="input" value="${escapeHtml(globalDays)}" placeholder="3,7,14,28">
          <div class="itemMeta" style="margin-top:8px">Applies to new topics (unless subject has custom days).</div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn btnPrimary" id="saveDays">Save</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardTitle">Holidays (affect revisions only, not homework)</div>

      <div class="sectionTitle">Weekly off days</div>
      <div class="row" style="flex-wrap:wrap; gap:14px">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d,i)=>`
          <label class="row" style="gap:8px; font-weight:900">
            <input type="checkbox" class="wkOff" data-i="${i}" ${weeklySet.has(i) ? "checked":""}>
            ${d}
          </label>
        `).join("")}
      </div>

      <div class="sectionTitle">Specific holidays</div>
      <div class="row" style="gap:10px; flex-wrap:wrap">
        <input id="holDate" class="input" type="date" style="max-width:200px">
        <input id="holDesc" class="input" placeholder="Description (optional)" style="max-width:340px">
        <button class="btn btnPrimary" id="holAdd">Add</button>
      </div>

      <div class="list" id="holList" style="margin-top:12px"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardTitle">Export</div>
      <div class="row" style="gap:10px; flex-wrap:wrap; margin-top:10px">
        <button class="btn btnPrimary" id="expJson">Export JSON</button>
        <button class="btn btnPrimary" id="expCsv">Export CSV</button>
        <button class="btn btnPrimary" id="expXlsx">Export XLSX</button>
        <button class="btn btnPrimary" id="expPdf">Export PDF</button>
      </div>
      <div class="itemMeta" style="margin-top:10px">
        Note: XLSX/PDF use browser libraries and are cached for offline after the first load.
      </div>
    </div>
  `;

  // theme options
  const sel = $("#setTheme");
  for (const t of THEMES) {
    const o = el(`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`);
    if (t === theme) o.selected = true;
    sel.appendChild(o);
  }

  $("#saveAppearance").addEventListener("click", async () => {
    const th = $("#setTheme").value;
    const ff = $("#setFont").value.trim() || "Inter";
    const sz = String(parseInt($("#setSize").value,10) || 13);

    await db.setSetting("theme", th);
    await db.setSetting("font_family", ff);
    await db.setSetting("font_size", sz);
    applyAppearance({ theme: th, font: ff, size: sz });
    toast("Appearance saved.");
  });

  $("#saveDays").addEventListener("click", async () => {
    const days = parseDaysCSV($("#setDays").value);
    if (!days.length) return toast("Invalid days. Example: 3,7,14,28");
    await db.setSetting("global_revision_days", days.join(","));
    toast("Global revision days saved.");
  });

  // weekly off
  $$(".wkOff").forEach(cb => cb.addEventListener("change", async () => {
    const current = new Set(((await db.getSetting("weekly_holidays"))||"")
      .split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));
    const i = parseInt(cb.dataset.i,10);
    if (cb.checked) current.add(i); else current.delete(i);
    await db.setSetting("weekly_holidays", [...current].sort((a,b)=>a-b).join(","));
  }));

  // holiday list
  const holList = $("#holList");
  const renderHol = async () => {
    const hs = await db.listHolidays();
    holList.innerHTML = "";
    if (!hs.length) {
      holList.appendChild(el(`<div class="muted" style="font-weight:800">No holidays added.</div>`));
      return;
    }
    for (const h of hs) {
      holList.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <div class="itemMain">
              <div class="itemTitle">${h.date}</div>
              <div class="itemMeta">${escapeHtml(h.description || "")}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn btnDanger" data-hdel="${h.id}">Remove</button>
          </div>
        </div>
      `));
    }
    $$("[data-hdel]").forEach(b => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.hdel,10);
      await db.deleteHoliday(id);
      renderHol();
    }));
  };
  renderHol();

  $("#holAdd").addEventListener("click", async () => {
    const d = $("#holDate").value;
    const desc = $("#holDesc").value.trim();
    if (!d) return toast("Choose a holiday date.");
    try{
      await db.addHoliday({ date: d, description: desc });
      $("#holDesc").value = "";
      renderHol();
    }catch(e){
      toast("This holiday date already exists.");
    }
  });

  // Exports
  $("#expJson").addEventListener("click", exportJSON);
  $("#expCsv").addEventListener("click", exportCSV);
  $("#expXlsx").addEventListener("click", exportXLSX);
  $("#expPdf").addEventListener("click", exportPDF);
}

/* ---------- Modals (Add/Edit) ---------- */
async function openSubjectModal(existing=null) {
  const isEdit = !!existing;
  const colors = ["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#85C1E9","#E67E22","#2ECC71","#9B59B6"];

  showModal({
    title: isEdit ? "Edit Subject" : "Add Subject",
    body: `
      <label class="muted" style="font-weight:900">Name</label>
      <input class="input" name="name" value="${escapeHtml(existing?.name || "")}" required>

      <label class="muted" style="font-weight:900">Color</label>
      <select name="color">
        ${colors.map(c => `<option value="${c}" ${existing?.color===c?"selected":""}>${c}</option>`).join("")}
      </select>

      <label class="row" style="gap:10px; font-weight:900; margin-top:6px">
        <input type="checkbox" name="useCustom" ${existing?.revisionDays?.length ? "checked":""}>
        Use custom revision days for this subject
      </label>

      <input class="input" name="customDays" placeholder="Example: 1,3,7,14,28"
        value="${escapeHtml(existing?.revisionDays?.join(",") || "")}">
    `,
    onSubmit: async (fd) => {
      const name = (fd.get("name")||"").trim();
      const color = fd.get("color");
      const useCustom = fd.get("useCustom") === "on";
      const customDays = useCustom ? parseDaysCSV(fd.get("customDays")) : null;

      if (!name) return toast("Enter subject name."), false;

      if (isEdit) {
        existing.name = name;
        existing.color = color;
        existing.revisionDays = customDays && customDays.length ? customDays : null;
        try { await db.updateSubject(existing); }
        catch { toast("Subject name already exists."); return false; }
      } else {
        try { await db.addSubject({ name, color, revisionDays: (customDays && customDays.length ? customDays : null) }); }
        catch { toast("Subject name already exists."); return false; }
      }
      await render("subjects");
      return true;
    }
  });
}

async function openTopicModal(existing=null) {
  const isEdit = !!existing;
  const subs = await db.listSubjects();
  if (!subs.length) return toast("Add a subject first.");

  showModal({
    title: isEdit ? "Edit Topic" : "Add Topic",
    body: `
      <label class="muted" style="font-weight:900">Subject</label>
      <select name="subjectId">
        ${subs.map(s => `<option value="${s.id}" ${existing?.subjectId===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="muted" style="font-weight:900">Topic name</label>
      <input class="input" name="name" value="${escapeHtml(existing?.name || "")}" required>

      ${isEdit ? "" : `
        <label class="muted" style="font-weight:900">Date studied</label>
        <input class="input" name="dateAdded" type="date" value="${isoToday()}" required>
      `}
    `,
    onSubmit: async (fd) => {
      const subjectId = parseInt(fd.get("subjectId"),10);
      const name = (fd.get("name")||"").trim();
      if (!name) return toast("Enter topic name."), false;

      if (isEdit) {
        existing.subjectId = subjectId;
        existing.name = name;
        await db.updateTopic(existing);
      } else {
        const dateAdded = fd.get("dateAdded") || isoToday();
        const topicId = await db.addTopic({ subjectId, name, dateAdded });

        // schedule revisions (with holidays affecting revisions only)
        const subject = await db.getSubject(subjectId);
        const globalDays = parseDaysCSV(await db.getSetting("global_revision_days") || "3,7,14,28");
        const dayIntervals = (subject?.revisionDays && subject.revisionDays.length) ? subject.revisionDays : globalDays;

        const holidaySet = new Set((await db.listHolidays()).map(h=>h.date));
        const weeklyOff = new Set(((await db.getSetting("weekly_holidays"))||"")
          .split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));

        const revs = scheduleRevisions({
          topicId,
          dateAddedISO: dateAdded,
          dayIntervals,
          holidaySet,
          weeklyOffSet: weeklyOff
        });
        await db.addRevisions(revs);
      }

      await render("today");
      return true;
    }
  });
}

async function openHomeworkModal(existing=null) {
  const isEdit = !!existing;
  const subs = await db.listSubjects();
  if (!subs.length) return toast("Add a subject first.");

  showModal({
    title: isEdit ? "Edit Homework" : "Add Homework",
    body: `
      <label class="muted" style="font-weight:900">Subject</label>
      <select name="subjectId">
        ${subs.map(s => `<option value="${s.id}" ${existing?.subjectId===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="muted" style="font-weight:900">Title</label>
      <input class="input" name="title" value="${escapeHtml(existing?.title || "")}" required>

      <label class="muted" style="font-weight:900">Description</label>
      <textarea name="description" placeholder="Optional">${escapeHtml(existing?.description || "")}</textarea>

      <div class="grid2">
        <div>
          <label class="muted" style="font-weight:900">Due date</label>
          <input class="input" name="dueDate" type="date" value="${escapeHtml(existing?.dueDate || addDays(isoToday(), 1))}" required>
        </div>
        <div>
          <label class="muted" style="font-weight:900">Priority</label>
          <select name="priority">
            ${["high","medium","low"].map(p => `<option value="${p}" ${(existing?.priority||"medium")===p?"selected":""}>${p}</option>`).join("")}
          </select>
        </div>
      </div>
    `,
    onSubmit: async (fd) => {
      const subjectId = parseInt(fd.get("subjectId"),10);
      const title = (fd.get("title")||"").trim();
      const description = (fd.get("description")||"").trim();
      const dueDate = fd.get("dueDate") || isoToday();
      const priority = fd.get("priority") || "medium";
      if (!title) return toast("Enter homework title."), false;

      if (isEdit) {
        existing.subjectId = subjectId;
        existing.title = title;
        existing.description = description;
        existing.dueDate = dueDate;
        existing.priority = priority;
        await db.updateHomework(existing);
      } else {
        await db.addHomework({
          subjectId, title, description, dueDate, priority,
          status: "pending",
          dateAdded: isoToday()
        });
      }
      await render("today");
      return true;
    }
  });
}

async function openTopicRevisionsModal(topicId) {
  const topic = await db.getTopic(topicId);
  const subs = await subjectsMap();
  const subj = subs.get(topic.subjectId);
  const revs = await db.listRevisionsByTopic(topicId);

  showModal({
    title: `Revisions — ${topic.name}`,
    submitText: "Close",
    body: `
      <div class="card" style="box-shadow:none">
        <div class="rowBetween">
          <div>
            <div class="itemTitle">${escapeHtml(topic.name)}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Added ${topic.dateAdded}</div>
          </div>
          <div>${pill(subj?.name || "Subject", subj?.color || "#999")}</div>
        </div>
        <hr class="sep">
        <div class="list">
          ${revs.map(r => `
            <div class="item">
              <div class="itemLeft">
                <div class="itemMain">
                  <div class="itemTitle">Revision ${r.revisionNum} (Day ${r.dayInterval})</div>
                  <div class="itemMeta">Scheduled: ${r.scheduledDate} • Status: ${r.status.toUpperCase()}</div>
                </div>
              </div>
              <div class="row">
                ${r.status==="pending" ? `
                  <button class="btn btnPrimary" type="button" data-rdone="${r.id}">Done</button>
                  <button class="btn" type="button" data-rskip="${r.id}">Skip</button>
                ` : `
                  <button class="btn" type="button" data-rundo="${r.id}">Mark Undone</button>
                `}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `,
    onSubmit: async () => true
  });

  $$("[data-rdone]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.rdone,10);
    const r = await db.getRevision(id);
    r.status = "done";
    await db.updateRevision(r);
    openTopicRevisionsModal(topicId);
  }));
  $$("[data-rskip]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.rskip,10);
    const r = await db.getRevision(id);
    r.status = "skipped";
    await db.updateRevision(r);
    openTopicRevisionsModal(topicId);
  }));
  $$("[data-rundo]").forEach(b => b.addEventListener("click", async () => {
    const id = parseInt(b.dataset.rundo,10);
    const r = await db.getRevision(id);
    r.status = "pending";
    await db.updateRevision(r);
    openTopicRevisionsModal(topicId);
  }));
}

/* ---------- EXPORTS (JSON/CSV/XLSX/PDF) ---------- */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

async function exportJSON() {
  const data = {
    exported: new Date().toISOString(),
    subjects: await db.listSubjects(),
    topics: await db.listTopics(),
    revisions: await db.revisionsInRange("0000-01-01","9999-12-31"),
    homework: await db.listHomework(),
    holidays: await db.listHolidays(),
    settings: {
      theme: await db.getSetting("theme"),
      font_family: await db.getSetting("font_family"),
      font_size: await db.getSetting("font_size"),
      global_revision_days: await db.getSetting("global_revision_days"),
      weekly_holidays: await db.getSetting("weekly_holidays"),
      last_opened: await db.getSetting("last_opened"),
    }
  };
  downloadBlob("studyloop_backup.json", new Blob([JSON.stringify(data,null,2)], { type:"application/json" }));
}

async function exportCSV() {
  const subs = await subjectsMap();
  const topics = await db.listTopics();
  const topicsM = new Map(topics.map(t=>[t.id,t]));
  const revisions = await db.revisionsInRange("0000-01-01","9999-12-31");

  const rows = [["Topic","Subject","Date Added","Revision #","Interval Day","Scheduled Date","Status"]];
  for (const r of revisions) {
    const t = topicsM.get(r.topicId);
    const s = subs.get(t?.subjectId);
    rows.push([
      t?.name || "",
      s?.name || "",
      t?.dateAdded || "",
      r.revisionNum,
      r.dayInterval,
      r.scheduledDate,
      r.status
    ]);
  }
  const csv = rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  downloadBlob("studyloop_data.csv", new Blob([csv], { type:"text/csv" }));
}

async function exportXLSX() {
  if (!window.XLSX) return toast("XLSX library not loaded yet. Connect once, reload, then try again.");
  const subs = await subjectsMap();
  const topics = await db.listTopics();
  const topicsM = new Map(topics.map(t=>[t.id,t]));
  const revisions = await db.revisionsInRange("0000-01-01","9999-12-31");
  const homework = await db.listHomework();

  const revRows = revisions.map(r => {
    const t = topicsM.get(r.topicId);
    const s = subs.get(t?.subjectId);
    return {
      Topic: t?.name || "",
      Subject: s?.name || "",
      "Date Added": t?.dateAdded || "",
      "Revision #": r.revisionNum,
      "Interval Day": r.dayInterval,
      "Scheduled Date": r.scheduledDate,
      Status: r.status
    };
  });

  const hwRows = homework.map(h => {
    const s = subs.get(h.subjectId);
    return {
      Title: h.title,
      Subject: s?.name || "",
      "Due Date": h.dueDate,
      Priority: h.priority,
      Status: h.status,
      Description: h.description || ""
    };
  });

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(revRows);
  const ws2 = XLSX.utils.json_to_sheet(hwRows);
  XLSX.utils.book_append_sheet(wb, ws1, "Revisions");
  XLSX.utils.book_append_sheet(wb, ws2, "Homework");

  const out = XLSX.write(wb, { bookType:"xlsx", type:"array" });
  downloadBlob("studyloop_data.xlsx", new Blob([out], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

async function exportPDF() {
  const jspdf = window.jspdf;
  if (!jspdf) return toast("PDF library not loaded yet. Connect once, reload, then try again.");

  const { jsPDF } = jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  const today = isoToday();
  const weekStart = addDays(today, -((new Date(today+"T00:00:00").getDay()+6)%7));
  const monthStart = `${today.slice(0,8)}01`;

  const revWeek = await db.revisionsInRange(weekStart, today);
  const revMonth = await db.revisionsInRange(monthStart, today);
  const topics = await db.listTopics();

  const line = (y, text, size=12, bold=false) => {
    doc.setFont("helvetica", bold ? "bold":"normal");
    doc.setFontSize(size);
    doc.text(text, 40, y);
  };

  line(50, "StudyLoop Report", 18, true);
  line(74, `Generated: ${new Date().toLocaleString()}`, 11);

  line(110, "Weekly", 14, true);
  line(130, `Revisions: ${revWeek.filter(r=>r.status==="done").length}/${revWeek.length} done`, 12);
  line(148, `Topics added: ${topics.filter(t=>t.dateAdded>=weekStart && t.dateAdded<=today).length}`, 12);

  line(185, "Monthly", 14, true);
  line(205, `Revisions: ${revMonth.filter(r=>r.status==="done").length}/${revMonth.length} done`, 12);
  line(223, `Topics added: ${topics.filter(t=>t.dateAdded>=monthStart && t.dateAdded<=today).length}`, 12);

  doc.save("studyloop_report.pdf");
}

/* ---------- App start ---------- */
async function start() {
  db = await StudyLoopDB.open();

  await db.ensureDefaults({
    theme: "Apple Light",
    font_family: "Inter",
    font_size: "13",
    global_revision_days: "3,7,14,28",
    weekly_holidays: "",
    last_opened: ""
  });

  await loadAppearance();
  await registerSW();
  await checkCarryForward();

  // default page
  setPage("today");
}

start();