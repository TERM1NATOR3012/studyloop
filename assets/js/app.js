import { StudyLoopDB } from "./db.js";
import { isoToday, addDays, parseDaysCSV, nextWorkDay, scheduleRevisions, distributeDates } from "./scheduler.js";

const THEMES = ["Apple Light","Apple Dark","Neon Dark","Pastel Dream","Cyber Night","Glass Gradient","Slate Ember"];
const FONT_SUGGESTIONS = ["Inter","system-ui","Segoe UI","Roboto","Poppins","Montserrat","JetBrains Mono","Consolas","Arial"];

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

/* ---------------- In-app toast (no browser alert) ---------------- */
let toastHost;
function ensureToastHost(){
  if (toastHost) return toastHost;
  toastHost = document.createElement("div");
  toastHost.className = "toastHost";
  document.body.appendChild(toastHost);
  return toastHost;
}
function toast(msg, type="success"){
  ensureToastHost();
  const node = el(`<div class="toast ${type}">${escapeHtml(msg)}</div>`);
  toastHost.appendChild(node);
  setTimeout(()=> node.remove(), 1800);
}

/* ---------------- Overlay host (dropdown + datepicker) ---------------- */
let overlayHost;
function ensureOverlayHost(){
  if (overlayHost) return overlayHost;
  overlayHost = document.createElement("div");
  overlayHost.className = "overlayHost hidden";
  overlayHost.addEventListener("click", (e) => {
    if (e.target === overlayHost) closeOverlay();
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlay(); });
  document.body.appendChild(overlayHost);
  return overlayHost;
}
function closeOverlay(){
  ensureOverlayHost();
  overlayHost.classList.add("hidden");
  overlayHost.innerHTML = "";
}
function openOverlay(node){
  ensureOverlayHost();
  overlayHost.innerHTML = "";
  overlayHost.appendChild(node);
  overlayHost.classList.remove("hidden");
}

/* ---------------- Custom dropdown for ALL <select> (rounded) ---------------- */
function enhanceSelects(root){
  $$("select", root).forEach(sel => {
    if (sel.dataset.enhanced === "1") return;
    sel.dataset.enhanced = "1";

    const proxy = document.createElement("button");
    proxy.type = "button";
    proxy.className = "selectProxy";

    const style = sel.getAttribute("style");
    if (style) proxy.setAttribute("style", style);

    const syncText = () => {
      const opt = sel.options[sel.selectedIndex];
      proxy.textContent = opt ? opt.text : "Select";
    };
    syncText();

    sel.style.display = "none";
    sel.insertAdjacentElement("beforebegin", proxy);
    sel.addEventListener("change", syncText);

    proxy.addEventListener("click", () => openSelectDropdown(sel, proxy));
  });
}

function openSelectDropdown(sel, anchorBtn){
  closeOverlay();

  const rect = anchorBtn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "dropdownMenu";
  menu.style.width = Math.max(rect.width, 220) + "px";

  for (let i=0;i<sel.options.length;i++){
    const opt = sel.options[i];
    const div = document.createElement("div");
    div.className = "dropdownItem" + (sel.selectedIndex === i ? " isSelected" : "");
    div.textContent = opt.text;

    div.addEventListener("click", () => {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    });

    menu.appendChild(div);
  }

  const pad = 8;
  let top = rect.bottom + pad;
  let left = rect.left;

  openOverlay(menu);

  const mh = menu.getBoundingClientRect().height;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < mh + 16) {
    top = Math.max(16, rect.top - mh - pad);
  }
  left = Math.min(left, window.innerWidth - menu.getBoundingClientRect().width - 16);

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/* ---------------- Custom date picker (rounded) ---------------- */
function enhanceDateInputs(root){
  $$("input[data-date='1']", root).forEach(inp => {
    if (inp.dataset.enhanced === "1") return;
    inp.dataset.enhanced = "1";
    inp.setAttribute("readonly", "readonly");
    inp.addEventListener("click", () => openDatePicker(inp));
  });
}

function openDatePicker(inputEl){
  closeOverlay();

  const value = inputEl.value && /^\d{4}-\d{2}-\d{2}$/.test(inputEl.value) ? inputEl.value : isoToday();
  let base = new Date(value + "T00:00:00");
  let year = base.getFullYear();
  let month = base.getMonth(); // 0..11
  let selected = inputEl.value || "";

  const pop = document.createElement("div");
  pop.className = "datePopover";
  pop.style.width = "340px";

  const buildDays = (startDow, daysInMonth) => {
    const today = isoToday();
    const cells = [];
    const totalCells = 42;
    for (let i=0;i<totalCells;i++){
      const day = i - startDow + 1;
      if (day < 1 || day > daysInMonth){
        cells.push(`<div class="dateDay isMuted"></div>`);
      } else {
        const iso = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const cls = [
          "dateDay",
          (iso === today) ? "isToday" : "",
          (iso === selected) ? "isSelected" : "",
        ].filter(Boolean).join(" ");
        cells.push(`<div class="${cls}" data-day="${iso}">${day}</div>`);
      }
    }
    return cells.join("");
  };

  const render = () => {
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const title = first.toLocaleDateString(undefined, { month:"long", year:"numeric" });

    pop.innerHTML = `
      <div class="dateHead">
        <div class="dateHeadTitle">${escapeHtml(title)}</div>
        <div class="dateHeadBtns">
          <button class="dateMiniBtn" type="button" data-prev>◀</button>
          <button class="dateMiniBtn" type="button" data-next>▶</button>
          <button class="dateMiniBtn" type="button" data-today>Today</button>
          <button class="dateMiniBtn" type="button" data-clear>Clear</button>
        </div>
      </div>

      <div class="dateGrid">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="dateDow">${d}</div>`).join("")}
        ${buildDays(startDow, daysInMonth)}
      </div>
    `;

    $("[data-prev]", pop).addEventListener("click", () => {
      month -= 1; if (month < 0){ month = 11; year -= 1; }
      render();
    });
    $("[data-next]", pop).addEventListener("click", () => {
      month += 1; if (month > 11){ month = 0; year += 1; }
      render();
    });
    $("[data-today]", pop).addEventListener("click", () => {
      inputEl.value = isoToday();
      selected = inputEl.value;
      inputEl.dispatchEvent(new Event("input", { bubbles:true }));
      inputEl.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    });
    $("[data-clear]", pop).addEventListener("click", () => {
      inputEl.value = "";
      selected = "";
      inputEl.dispatchEvent(new Event("input", { bubbles:true }));
      inputEl.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    });

    $$("[data-day]", pop).forEach(btn => {
      btn.addEventListener("click", () => {
        const iso = btn.dataset.day;
        inputEl.value = iso;
        selected = iso;
        inputEl.dispatchEvent(new Event("input", { bubbles:true }));
        inputEl.dispatchEvent(new Event("change", { bubbles:true }));
        closeOverlay();
      });
    });
  };

  render();
  openOverlay(pop);

  const rect = inputEl.getBoundingClientRect();
  const pad = 8;
  let top = rect.bottom + pad;
  let left = rect.left;

  const ph = pop.getBoundingClientRect().height;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < ph + 16) top = Math.max(16, rect.top - ph - pad);

  left = Math.min(left, window.innerWidth - pop.getBoundingClientRect().width - 16);
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

/* ---------------- Modal system ---------------- */
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
  enhanceSelects(modal);
  enhanceDateInputs(modal);

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
    const ok = await onSubmit?.(new FormData(form));
    if (ok !== false) close();
  });
}

function confirmModal({ title="Confirm", message="Are you sure?", confirmText="OK", danger=false }) {
  return new Promise((resolve) => {
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
        <div class="modalBody">
          <div class="card" style="box-shadow:none">
            <div style="font-weight:900">${escapeHtml(message)}</div>
          </div>
          <div class="modalFooter">
            <button class="btn" type="button" data-cancel>Cancel</button>
            <button class="btn ${danger ? "btnDanger":"btnPrimary"}" type="button" data-ok>${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>
    `);

    host.appendChild(modal);

    const close = () => {
      host.classList.add("hidden");
      host.setAttribute("aria-hidden","true");
      host.innerHTML = "";
    };

    $("[data-close]", host).addEventListener("click", () => { close(); resolve(false); });
    $("[data-cancel]", host).addEventListener("click", () => { close(); resolve(false); });
    $("[data-ok]", host).addEventListener("click", () => { close(); resolve(true); });
    host.addEventListener("click", (e) => { if (e.target === host) { close(); resolve(false); } }, { once:true });
  });
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
  }catch{}
}

/* ---------- Navigation ---------- */
function setPage(pageName) {
  $$(".navItem").forEach(b => b.classList.toggle("isActive", b.dataset.page === pageName));
  $$(".page").forEach(p => p.classList.remove("isVisible"));
  $(`#page-${pageName}`).classList.add("isVisible");
  render(pageName);
}
$$(".navItem").forEach(b => b.addEventListener("click", () => setPage(b.dataset.page)));

/* ---------- Helpers ---------- */
async function subjectsMap() {
  const subs = await db.listSubjects();
  const m = new Map();
  for (const s of subs) m.set(s.id, s);
  return m;
}

/* ---------- Carry-forward ---------- */
async function checkCarryForward() {
  const last = await db.getSetting("last_opened");
  const today = isoToday();
  await db.setSetting("last_opened", today);

  if (!last || last >= today) return;
  const yesterday = addDays(today, -1);
  if (last >= yesterday) return;

  const from = addDays(last, 1);
  const missed = await db.pendingRevisionsInRange(from, yesterday);
  if (!missed.length) return;

  showModal({
    title: "Missed revisions",
    submitText: "Apply",
    body: `
      <div class="card" style="box-shadow:none">
        <div style="font-weight:950">${missed.length} pending revision(s)</div>
        <div class="row" style="flex-wrap:wrap; margin-top:10px">
          <label class="row" style="font-weight:900"><input type="radio" name="mode" value="all" checked> Load all today</label>
          <label class="row" style="font-weight:900"><input type="radio" name="mode" value="spread"> Spread over</label>
          <input class="input" style="max-width:120px" name="spreadDays" type="number" min="2" max="30" value="7">
        </div>
      </div>
    `,
    onSubmit: async (fd) => {
      const mode = fd.get("mode");
      const spreadDays = parseInt(fd.get("spreadDays"),10) || 7;

      const holidays = new Set((await db.listHolidays()).map(h => h.date));
      const weeklyOff = new Set(((await db.getSetting("weekly_holidays"))||"")
        .split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));

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

      toast("Updated.");
      await render("today");
    }
  });
}

/* ---------- Render dispatcher ---------- */
async function render(pageName) {
  closeOverlay();
  switch(pageName){
    case "today": return renderToday();
    case "calendar": return renderCalendar();
    case "upcoming": return renderUpcoming();
    case "topics": return renderTopics();
    case "homework": return renderHomework();
    case "exams": return renderExams();          // NEW
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
          <div class="cardTitle">Revisions</div>
          <div class="itemMeta">${pending.length} pending</div>
        </div>
      </div>
      <div class="list" id="todayRevList"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Homework</div>
          <div class="itemMeta">${hwToday.length} due • ${overdue.length} overdue</div>
        </div>
      </div>
      <div class="list" id="todayHWList"></div>
    </div>
  `;

  $("#btnAddTopic").addEventListener("click", () => openTopicModal());
  $("#btnAddHW").addEventListener("click", () => openHomeworkModal());

  const list = $("#todayRevList");
  if (!revs.length) {
    list.appendChild(el(`<div class="muted" style="font-weight:800">No revisions.</div>`));
  } else {
    for (const r of revs) {
      const topic = await db.getTopic(r.topicId);
      const subj = subs.get(topic.subjectId);

      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(topic?.name || "Topic")}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} • ${r.status.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            ${r.status==="pending" ? `
              <button class="btn btnPrimary" data-done="${r.id}">Done</button>
              <button class="btn" data-skip="${r.id}">Skip</button>
            ` : `
              <button class="btn" data-undo="${r.id}">Undone</button>
            `}
          </div>
        </div>
      `));
    }
  }

  $$("[data-done]").forEach(b => b.addEventListener("click", async () => {
    const r = await db.getRevision(parseInt(b.dataset.done,10));
    r.status = "done";
    await db.updateRevision(r);
    await renderToday();
  }));
  $$("[data-skip]").forEach(b => b.addEventListener("click", async () => {
    const r = await db.getRevision(parseInt(b.dataset.skip,10));
    r.status = "skipped";
    await db.updateRevision(r);
    await renderToday();
  }));
  $$("[data-undo]").forEach(b => b.addEventListener("click", async () => {
    const r = await db.getRevision(parseInt(b.dataset.undo,10));
    r.status = "pending";
    await db.updateRevision(r);
    await renderToday();
  }));

  const hwList = $("#todayHWList");
  const renderHWItem = async (h, overdueFlag=false) => {
    const subj = subs.get(h.subjectId);
    hwList.appendChild(el(`
      <div class="item ${overdueFlag ? "overdue":""}">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(h.title)}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${h.dueDate} • ${h.priority.toUpperCase()}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn btnPrimary" data-hwdone="${h.id}">Done</button>
          <button class="btn" data-hwedit="${h.id}">Edit</button>
          <button class="btn btnDanger" data-hwdel="${h.id}">Delete</button>
        </div>
      </div>
    `));
  };

  if (!hwToday.length && !overdue.length) {
    hwList.appendChild(el(`<div class="muted" style="font-weight:800">No homework.</div>`));
  } else {
    for (const h of overdue) await renderHWItem(h, true);
    for (const h of hwToday) await renderHWItem(h, false);
  }

  $$("[data-hwdone]").forEach(b => b.addEventListener("click", async () => {
    const h = await db.getHomework(parseInt(b.dataset.hwdone,10));
    h.status = "completed";
    await db.updateHomework(h);
    await renderToday();
  }));
  $$("[data-hwedit]").forEach(b => b.addEventListener("click", async () => {
    const h = await db.getHomework(parseInt(b.dataset.hwedit,10));
    openHomeworkModal(h);
  }));
  $$("[data-hwdel]").forEach(b => b.addEventListener("click", async () => {
    const ok = await confirmModal({ title:"Delete homework", message:"Delete this homework?", confirmText:"Delete", danger:true });
    if (!ok) return;
    await db.deleteHomework(parseInt(b.dataset.hwdel,10));
    await renderToday();
  }));

  await db.logDay(today, pending.length === 0);
}

/* ---------- CALENDAR (shows exams too) ---------- */
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

  const monthPrefix = `${calYear}-${String(calMonth).padStart(2,"0")}`;
  const allRev = await db.revisionsInRange(`${monthPrefix}-01`, `${monthPrefix}-31`);
  const allHw = await db.listHomework();
  const allEx = await db.listExams(); // NEW

  const revCount = new Map();
  const hwCount = new Map();
  const exCount = new Map();

  for (const r of allRev) if (r.status === "pending") revCount.set(r.scheduledDate, (revCount.get(r.scheduledDate)||0)+1);

  for (const h of allHw) {
    if (h.status !== "pending") continue;
    if (h.dueDate.slice(0,7) !== monthPrefix) continue;
    hwCount.set(h.dueDate, (hwCount.get(h.dueDate)||0)+1);
  }

  for (const e of allEx) {
    const st = e.status || "scheduled";
    if (st === "completed") continue;           // show only upcoming/scheduled on calendar counts
    if ((e.examDate||"").slice(0,7) !== monthPrefix) continue;
    exCount.set(e.examDate, (exCount.get(e.examDate)||0)+1);
  }

  const monthName = new Date(Date.UTC(calYear, calMonth-1, 1)).toLocaleDateString(undefined, { month:"long", year:"numeric" });

  host.innerHTML = `
    <h1 class="pageTitle">Calendar</h1>

    <div class="card">
      <div class="rowBetween">
        <div class="row" style="gap:10px">
          <button class="btn" id="calPrev">Previous</button>
          <button class="btn" id="calNext">Next</button>
        </div>
        <div style="font-weight:950">${escapeHtml(monthName)}</div>
        <div class="row" style="gap:10px">
          <button class="btn btnPrimary" id="calAddExam">Add Exam</button>
        </div>
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
        </div>
      </div>
      <div class="list" id="calDetailList"></div>
    </div>
  `;

  $("#calAddExam").addEventListener("click", () => openExamModal(null, calSelected));

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

  for (let i=0;i<42;i++){
    const day = i - startDow + 1;
    if (day < 1 || day > daysInMonth) {
      grid.appendChild(el(`<div style="min-height:72px"></div>`));
      continue;
    }
    const iso = `${monthPrefix}-${String(day).padStart(2,"0")}`;
    const selected = iso === calSelected;

    const r = revCount.get(iso)||0;
    const h = hwCount.get(iso)||0;
    const e = exCount.get(iso)||0;

    const counts = [];
    if (r) counts.push(`${r}R`);
    if (h) counts.push(`${h}H`);
    if (e) counts.push(`${e}E`);

    const cell = el(`
      <div class="calCell ${selected ? "isSelected":""}" data-date="${iso}">
        <div class="calDay">${day}</div>
        <div class="calCounts">${counts.join(" ")}</div>
      </div>
    `);
    cell.addEventListener("click", () => { calSelected = iso; renderCalendar(); });
    grid.appendChild(cell);
  }

  await renderCalendarDetails(calSelected);
}

async function renderCalendarDetails(dateISO) {
  $("#calSel").textContent = dateISO;
  const subs = await subjectsMap();

  const revs = await db.listRevisionsByDate(dateISO);
  const hws = await db.listHomeworkByDate(dateISO);
  const exs = await db.listExamsByDate(dateISO);  // NEW

  const list = $("#calDetailList");
  list.innerHTML = "";

  if (!revs.length && !hws.length && !exs.length) {
    list.appendChild(el(`<div class="muted" style="font-weight:800">Nothing scheduled.</div>`));
    return;
  }

  // Exams first (important)
  if (exs.length) {
    list.appendChild(el(`<div class="sectionTitle" style="margin:0">Exams</div>`));
    for (const e of exs) {
      const subj = subs.get(e.subjectId);
      const st = e.status || "scheduled";
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(e.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${st.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn" data-exedit="${e.id}">Edit</button>
            <button class="btn btnDanger" data-exdel="${e.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-exedit]").forEach(b => b.addEventListener("click", async () => {
      const e = await db.getExam(parseInt(b.dataset.exedit,10));
      openExamModal(e);
    }));
    $$("[data-exdel]").forEach(b => b.addEventListener("click", async () => {
      const ok = await confirmModal({ title:"Delete exam", message:"Delete this exam?", confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteExam(parseInt(b.dataset.exdel,10));
      toast("Deleted.");
      await renderCalendar();
    }));
  }

  if (revs.length) {
    list.appendChild(el(`<div class="sectionTitle" style="margin:0">Revisions</div>`));
    for (const r of revs) {
      const tp = await db.getTopic(r.topicId);
      const subj = subs.get(tp.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp?.name || "Topic")}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} • ${r.status.toUpperCase()}</div>
            </div>
          </div>
        </div>
      `));
    }
  }

  if (hws.length) {
    list.appendChild(el(`<div class="sectionTitle" style="margin:0">Homework</div>`));
    for (const h of hws) {
      const subj = subs.get(h.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(h.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${h.priority.toUpperCase()} • ${h.status.toUpperCase()}</div>
            </div>
          </div>
        </div>
      `));
    }
  }
}

/* ---------- UPCOMING ---------- */
async function renderUpcoming() {
  const host = $("#page-upcoming");
  const today = isoToday();
  const subs = await subjectsMap();

  host.innerHTML = `
    <h1 class="pageTitle">Upcoming</h1>
    <div class="list" id="upList"></div>
  `;

  const list = $("#upList");
  for (let i=0;i<7;i++){
    const d = addDays(today, i);
    const revs = await db.listPendingRevisionsByDate(d);

    const header = el(`
      <div class="card" style="box-shadow:none">
        <div class="rowBetween">
          <div style="font-weight:950">${d}</div>
          <div class="muted" style="font-weight:850">${revs.length} revisions</div>
        </div>
      </div>
    `);
    list.appendChild(header);

    if (!revs.length) {
      list.appendChild(el(`<div class="muted" style="padding:0 12px 12px 12px;font-weight:800">Nothing.</div>`));
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
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum}</div>
            </div>
          </div>
        </div>
      `));
    }
  }
}

/* ---------- TOPICS ---------- */
async function renderTopics() {
  const host = $("#page-topics");
  const subs = await db.listSubjects();

  host.innerHTML = `
    <h1 class="pageTitle">Topics</h1>

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
  enhanceSelects(host);

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
      list.appendChild(el(`<div class="muted" style="font-weight:800">No topics.</div>`));
      return;
    }

    for (const tp of topics) {
      const subj = m.get(tp.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp.name)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${tp.dateAdded}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn" data-edit="${tp.id}">Edit</button>
            <button class="btn btnDanger" data-del="${tp.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-edit]").forEach(b => b.addEventListener("click", async () => {
      const tp = await db.getTopic(parseInt(b.dataset.edit,10));
      openTopicModal(tp);
    }));

    $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const tp = await db.getTopic(parseInt(b.dataset.del,10));
      const ok = await confirmModal({ title:"Delete topic", message:`Delete "${tp.name}"?`, confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteTopic(tp.id);
      renderTopics();
    }));
  }

  renderTopicList();
}

/* ---------- HOMEWORK ---------- */
async function renderHomework() {
  const host = $("#page-homework");
  const subs = await db.listSubjects();
  const today = isoToday();

  host.innerHTML = `
    <h1 class="pageTitle">Homework</h1>

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
  enhanceSelects(host);

  $("#hwAdd").addEventListener("click", () => openHomeworkModal());
  $("#hwSubj").addEventListener("change", () => renderHWList());
  $("#hwStatus").addEventListener("change", () => renderHWList());

  async function renderHWList() {
    const sid = $("#hwSubj").value ? parseInt($("#hwSubj").value,10) : null;
    const st = $("#hwStatus").value || null;
    const hws = await db.listHomework({ subjectId: sid, status: st });

    const subsM = new Map(subs.map(s=>[s.id,s]));
    const list = $("#hwList");
    list.innerHTML = "";

    if (!hws.length) {
      list.appendChild(el(`<div class="muted" style="font-weight:800">No homework.</div>`));
      return;
    }

    for (const h of hws) {
      const subj = subsM.get(h.subjectId);
      const overdue = h.status==="pending" && h.dueDate < today;

      list.appendChild(el(`
        <div class="item ${overdue ? "overdue":""}">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(h.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${h.dueDate} • ${h.priority.toUpperCase()} • ${h.status.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" data-toggle="${h.id}">${h.status==="pending" ? "Complete":"Pending"}</button>
            <button class="btn" data-edit="${h.id}">Edit</button>
            <button class="btn btnDanger" data-del="${h.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-toggle]").forEach(b => b.addEventListener("click", async () => {
      const h = await db.getHomework(parseInt(b.dataset.toggle,10));
      h.status = (h.status==="pending") ? "completed" : "pending";
      await db.updateHomework(h);
      renderHWList();
    }));
    $$("[data-edit]").forEach(b => b.addEventListener("click", async () => {
      const h = await db.getHomework(parseInt(b.dataset.edit,10));
      openHomeworkModal(h);
    }));
    $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const ok = await confirmModal({ title:"Delete homework", message:"Delete this homework?", confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteHomework(parseInt(b.dataset.del,10));
      renderHWList();
    }));
  }

  renderHWList();
}

/* ---------- EXAMS (NEW PAGE) ---------- */
async function renderExams() {
  const host = $("#page-exams");
  const subs = await db.listSubjects();
  const subsM = new Map(subs.map(s=>[s.id,s]));
  const today = isoToday();

  host.innerHTML = `
    <h1 class="pageTitle">Exams</h1>

    <div class="card">
      <div class="row" style="gap:10px; flex-wrap:wrap">
        <select id="exSubj" style="max-width:240px"></select>
        <select id="exStatus" style="max-width:220px">
          <option value="">All</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
        </select>
        <button class="btn btnPrimary" id="exAdd">Add Exam</button>
      </div>
      <hr class="sep">
      <div class="list" id="exList"></div>
    </div>
  `;

  const subjSel = $("#exSubj");
  subjSel.appendChild(el(`<option value="">All subjects</option>`));
  for (const s of subs) subjSel.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`));
  enhanceSelects(host);

  $("#exAdd").addEventListener("click", () => openExamModal());
  $("#exSubj").addEventListener("change", () => renderExamList());
  $("#exStatus").addEventListener("change", () => renderExamList());

  async function renderExamList() {
    const sid = $("#exSubj").value ? parseInt($("#exSubj").value,10) : null;
    const st = $("#exStatus").value || null;
    const exs = await db.listExams({ subjectId: sid, status: st });

    const list = $("#exList");
    list.innerHTML = "";

    if (!exs.length) {
      list.appendChild(el(`<div class="muted" style="font-weight:800">No exams.</div>`));
      return;
    }

    for (const e of exs) {
      const subj = subsM.get(e.subjectId);
      const status = e.status || "scheduled";
      const isPast = status !== "completed" && (e.examDate < today);

      list.appendChild(el(`
        <div class="item ${isPast ? "overdue":""}">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(e.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${e.examDate}${e.examTime ? (" • " + e.examTime) : ""} • ${status.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" data-toggle="${e.id}">${status==="scheduled" ? "Completed" : "Scheduled"}</button>
            <button class="btn" data-edit="${e.id}">Edit</button>
            <button class="btn btnDanger" data-del="${e.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-toggle]").forEach(b => b.addEventListener("click", async () => {
      const e = await db.getExam(parseInt(b.dataset.toggle,10));
      const status = e.status || "scheduled";
      e.status = (status === "scheduled") ? "completed" : "scheduled";
      await db.updateExam(e);
      renderExamList();
    }));

    $$("[data-edit]").forEach(b => b.addEventListener("click", async () => {
      const e = await db.getExam(parseInt(b.dataset.edit,10));
      openExamModal(e);
    }));

    $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const ok = await confirmModal({ title:"Delete exam", message:"Delete this exam?", confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteExam(parseInt(b.dataset.del,10));
      renderExamList();
    }));
  }

  renderExamList();
}

/* ---------- SUBJECTS ---------- */
async function renderSubjects() {
  const host = $("#page-subjects");
  const subjects = await db.listSubjects();

  host.innerHTML = `
    <h1 class="pageTitle">Subjects</h1>

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
    list.appendChild(el(`<div class="muted" style="font-weight:800">No subjects.</div>`));
    return;
  }

  for (const s of subjects) {
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${s.color}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(s.name)}</div>
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
    const s = await db.getSubject(parseInt(b.dataset.edit,10));
    openSubjectModal(s);
  }));

  $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
    const s = await db.getSubject(parseInt(b.dataset.del,10));
    const ok = await confirmModal({ title:"Delete subject", message:`Delete "${s.name}"?`, confirmText:"Delete", danger:true });
    if (!ok) return;
    await db.deleteSubject(s.id);
    renderSubjects();
  }));
}

/* ---------- DASHBOARD (unchanged minimal) ---------- */
async function renderDashboard() {
  const host = $("#page-dashboard");
  host.innerHTML = `
    <h1 class="pageTitle">Dashboard</h1>

    <div class="rowBetween" style="margin-bottom: 12px">
      <div class="segment">
        <button class="segBtn" id="segWeek" aria-pressed="true">Week</button>
        <button class="segBtn" id="segMonth" aria-pressed="false">Month</button>
      </div>
    </div>

    <div class="grid4" id="dashCards"></div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div>
          <div class="cardTitle" id="dashChartTitle">Revisions</div>
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
    ? addDays(today, -((new Date(today+"T00:00:00").getDay()+6)%7))
    : `${today.slice(0,8)}01`;

  const topics = await db.listTopics();
  const topicsAdded = topics.filter(t => t.dateAdded >= start && t.dateAdded <= today).length;

  const revs = await db.revisionsInRange(start, today);
  const total = revs.length;
  const done = revs.filter(r=>r.status==="done").length;
  const rate = total ? Math.round((done/total)*1000)/10 : 0;

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
  cards.appendChild(card("Topics", String(topicsAdded)));
  cards.appendChild(card("Done", `${done}/${total}`));
  cards.appendChild(card("Rate", `${rate}%`));
  cards.appendChild(card("Streak", `${streak}`));

  const days = [];
  if (mode === "week") for (let i=0;i<7;i++) days.push(addDays(start, i));
  else {
    const endDay = parseInt(today.slice(8,10),10);
    for (let i=1;i<=endDay;i++) days.push(`${today.slice(0,8)}${String(i).padStart(2,"0")}`);
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

    chart.appendChild(el(`
      <div style="min-width:34px; text-align:center">
        <div style="height:150px; display:flex; align-items:flex-end; justify-content:center">
          <div style="width:18px; height:${h}px; border-radius:10px; background: rgba(127,127,127,.35); position:relative; overflow:hidden">
            <div style="position:absolute; bottom:0; left:0; right:0; height:${h2}px; background: var(--primary); border-radius:10px"></div>
          </div>
        </div>
        <div class="muted" style="font-weight:900; font-size:12px">${label}</div>
      </div>
    `));
  }

  const host = $("#dashChart");
  host.innerHTML = "";
  host.appendChild(chart);
}

/* ---------- SETTINGS (removed extra texts) ---------- */
function debounce(fn, ms){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function renderSettings() {
  const host = $("#page-settings");
  const theme = (await db.getSetting("theme")) || "Apple Light";
  const font = (await db.getSetting("font_family")) || "Inter";
  const size = (await db.getSetting("font_size")) || "13";
  const globalDays = (await db.getSetting("global_revision_days")) || "3,7,14,28";
  const weekly = (await db.getSetting("weekly_holidays")) || "";
  const weeklySet = new Set(weekly.split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));

  host.innerHTML = `
    <h1 class="pageTitle">Settings</h1>

    <div class="grid2">
      <div class="card">
        <div class="cardTitle">Appearance</div>

        <div class="row" style="margin-top:10px">
          <div style="flex:1">
            <div class="muted" style="font-weight:900">Theme</div>
            <select id="setTheme">
              ${THEMES.map(t=>`<option value="${escapeHtml(t)}" ${t===theme?"selected":""}>${escapeHtml(t)}</option>`).join("")}
            </select>
          </div>

          <div style="flex:1">
            <div class="muted" style="font-weight:900">Font size</div>
            <input id="setSize" class="input" type="number" min="10" max="22" value="${escapeHtml(size)}">
          </div>
        </div>

        <div style="margin-top:10px">
          <div class="muted" style="font-weight:900">Font family</div>
          <input id="setFont" class="input" list="fontList" value="${escapeHtml(font)}" placeholder="Inter">
          <datalist id="fontList">
            ${FONT_SUGGESTIONS.map(f=>`<option value="${escapeHtml(f)}"></option>`).join("")}
          </datalist>
        </div>
      </div>

      <div class="card">
        <div class="cardTitle">Revision Settings</div>
        <div style="margin-top:10px">
          <div class="muted" style="font-weight:900">Global revision days</div>
          <input id="setDays" class="input" value="${escapeHtml(globalDays)}" placeholder="3,7,14,28">
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardTitle">Holidays</div>

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
        <input id="holDate" class="input" data-date="1" placeholder="YYYY-MM-DD" style="max-width:200px" value="">
        <input id="holDesc" class="input" placeholder="Description" style="max-width:340px">
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
    </div>
  `;

  enhanceSelects(host);
  enhanceDateInputs(host);

  const saveAppearanceDebounced = debounce(async () => {
    const th = $("#setTheme").value;
    const ff = $("#setFont").value.trim() || "Inter";
    const sz = String(parseInt($("#setSize").value,10) || 13);

    await db.setSetting("theme", th);
    await db.setSetting("font_family", ff);
    await db.setSetting("font_size", sz);
    applyAppearance({ theme: th, font: ff, size: sz });
    toast("Saved.");
  }, 200);

  $("#setTheme").addEventListener("change", saveAppearanceDebounced);
  $("#setFont").addEventListener("input", saveAppearanceDebounced);
  $("#setSize").addEventListener("input", saveAppearanceDebounced);

  const saveDaysDebounced = debounce(async () => {
    const days = parseDaysCSV($("#setDays").value);
    if (!days.length) return;
    await db.setSetting("global_revision_days", days.join(","));
    toast("Saved.");
  }, 350);

  $("#setDays").addEventListener("input", saveDaysDebounced);
  $("#setDays").addEventListener("blur", async () => {
    const days = parseDaysCSV($("#setDays").value);
    if (!days.length) return toast("Invalid.", "error");
    await db.setSetting("global_revision_days", days.join(","));
    toast("Saved.");
  });

  // weekly off auto-save
  $$(".wkOff").forEach(cb => cb.addEventListener("change", async () => {
    const current = new Set(((await db.getSetting("weekly_holidays"))||"")
      .split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));
    const i = parseInt(cb.dataset.i,10);
    if (cb.checked) current.add(i); else current.delete(i);
    await db.setSetting("weekly_holidays", [...current].sort((a,b)=>a-b).join(","));
    toast("Saved.");
  }));

  // holiday list
  const holList = $("#holList");
  const renderHol = async () => {
    const hs = await db.listHolidays();
    holList.innerHTML = "";
    if (!hs.length) {
      holList.appendChild(el(`<div class="muted" style="font-weight:800">No holidays.</div>`));
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
      const ok = await confirmModal({ title:"Remove holiday", message:"Remove this holiday?", confirmText:"Remove", danger:true });
      if (!ok) return;
      await db.deleteHoliday(parseInt(b.dataset.hdel,10));
      toast("Removed.");
      renderHol();
    }));
  };
  renderHol();

  $("#holAdd").addEventListener("click", async () => {
    const d = $("#holDate").value;
    const desc = $("#holDesc").value.trim();
    if (!d) return toast("Choose date.", "error");
    try{
      await db.addHoliday({ date: d, description: desc });
      $("#holDesc").value = "";
      $("#holDate").value = "";
      toast("Added.");
      renderHol();
    }catch{
      toast("Already exists.", "error");
    }
  });

  // exports
  $("#expJson").addEventListener("click", exportJSON);
  $("#expCsv").addEventListener("click", exportCSV);
  $("#expXlsx").addEventListener("click", exportXLSX);
  $("#expPdf").addEventListener("click", exportPDF);
}

/* ---------- Modals ---------- */
async function openSubjectModal(existing=null) {
  const isEdit = !!existing;
  const colors = ["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#85C1E9","#E67E22","#2ECC71","#9B59B6"];

  showModal({
    title: isEdit ? "Edit Subject" : "Add Subject",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="muted" style="font-weight:900">Name</label>
      <input class="input" name="name" value="${escapeHtml(existing?.name || "")}" required>

      <label class="muted" style="font-weight:900">Color</label>
      <select name="color">
        ${colors.map(c => `<option value="${c}" ${existing?.color===c?"selected":""}>${c}</option>`).join("")}
      </select>

      <label class="row" style="gap:10px; font-weight:900; margin-top:6px">
        <input type="checkbox" name="useCustom" ${existing?.revisionDays?.length ? "checked":""}>
        Custom revision days
      </label>

      <input class="input" name="customDays" placeholder="1,3,7,14,28"
        value="${escapeHtml(existing?.revisionDays?.join(",") || "")}">
    `,
    onSubmit: async (fd) => {
      const name = (fd.get("name")||"").trim();
      const color = fd.get("color");
      const useCustom = fd.get("useCustom") === "on";
      const customDays = useCustom ? parseDaysCSV(fd.get("customDays")) : null;

      if (!name) return toast("Enter name.", "error"), false;

      if (isEdit) {
        existing.name = name;
        existing.color = color;
        existing.revisionDays = customDays && customDays.length ? customDays : null;
        try { await db.updateSubject(existing); }
        catch { toast("Name exists.", "error"); return false; }
      } else {
        try { await db.addSubject({ name, color, revisionDays: (customDays && customDays.length ? customDays : null) }); }
        catch { toast("Name exists.", "error"); return false; }
      }
      toast("Saved.");
      await render("subjects");
      return true;
    }
  });
}

async function openTopicModal(existing=null) {
  const isEdit = !!existing;
  const subs = await db.listSubjects();
  if (!subs.length) return toast("Add subject first.", "error");

  showModal({
    title: isEdit ? "Edit Topic" : "Add Topic",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="muted" style="font-weight:900">Subject</label>
      <select name="subjectId">
        ${subs.map(s => `<option value="${s.id}" ${existing?.subjectId===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="muted" style="font-weight:900">Topic</label>
      <input class="input" name="name" value="${escapeHtml(existing?.name || "")}" required>

      ${isEdit ? "" : `
        <label class="muted" style="font-weight:900">Date</label>
        <input class="input" name="dateAdded" data-date="1" value="${isoToday()}" placeholder="YYYY-MM-DD" required>
      `}
    `,
    onSubmit: async (fd) => {
      const subjectId = parseInt(fd.get("subjectId"),10);
      const name = (fd.get("name")||"").trim();
      if (!name) return toast("Enter topic.", "error"), false;

      if (isEdit) {
        existing.subjectId = subjectId;
        existing.name = name;
        await db.updateTopic(existing);
      } else {
        const dateAdded = fd.get("dateAdded") || isoToday();
        const topicId = await db.addTopic({ subjectId, name, dateAdded });

        const subject = await db.getSubject(subjectId);
        const globalDays = parseDaysCSV(await db.getSetting("global_revision_days") || "3,7,14,28");
        const dayIntervals = (subject?.revisionDays && subject.revisionDays.length) ? subject.revisionDays : globalDays;

        const holidaySet = new Set((await db.listHolidays()).map(h=>h.date));
        const weeklyOff = new Set(((await db.getSetting("weekly_holidays"))||"")
          .split(",").map(x=>parseInt(x,10)).filter(Number.isFinite));

        const revs = scheduleRevisions({ topicId, dateAddedISO: dateAdded, dayIntervals, holidaySet, weeklyOffSet: weeklyOff });
        await db.addRevisions(revs);
      }

      toast("Saved.");
      await render("today");
      return true;
    }
  });
}

async function openHomeworkModal(existing=null) {
  const isEdit = !!existing;
  const subs = await db.listSubjects();
  if (!subs.length) return toast("Add subject first.", "error");

  showModal({
    title: isEdit ? "Edit Homework" : "Add Homework",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="muted" style="font-weight:900">Subject</label>
      <select name="subjectId">
        ${subs.map(s => `<option value="${s.id}" ${existing?.subjectId===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="muted" style="font-weight:900">Title</label>
      <input class="input" name="title" value="${escapeHtml(existing?.title || "")}" required>

      <label class="muted" style="font-weight:900">Description</label>
      <textarea name="description" placeholder="">${escapeHtml(existing?.description || "")}</textarea>

      <div class="grid2">
        <div>
          <label class="muted" style="font-weight:900">Due date</label>
          <input class="input" name="dueDate" data-date="1" value="${escapeHtml(existing?.dueDate || addDays(isoToday(), 1))}" placeholder="YYYY-MM-DD" required>
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
      if (!title) return toast("Enter title.", "error"), false;

      if (isEdit) {
        existing.subjectId = subjectId;
        existing.title = title;
        existing.description = description;
        existing.dueDate = dueDate;
        existing.priority = priority;
        await db.updateHomework(existing);
      } else {
        await db.addHomework({ subjectId, title, description, dueDate, priority, status:"pending", dateAdded: isoToday() });
      }
      toast("Saved.");
      await render("today");
      return true;
    }
  });
}

async function openExamModal(existing=null, defaultDate=null) {
  const isEdit = !!existing;
  const subs = await db.listSubjects();
  if (!subs.length) return toast("Add subject first.", "error");

  const examDate = existing?.examDate || defaultDate || isoToday();
  const examTime = existing?.examTime || "";

  showModal({
    title: isEdit ? "Edit Exam" : "Add Exam",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="muted" style="font-weight:900">Subject</label>
      <select name="subjectId">
        ${subs.map(s => `<option value="${s.id}" ${existing?.subjectId===s.id?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="muted" style="font-weight:900">Title</label>
      <input class="input" name="title" value="${escapeHtml(existing?.title || "")}" required>

      <label class="muted" style="font-weight:900">Details</label>
      <textarea name="description" placeholder="">${escapeHtml(existing?.description || "")}</textarea>

      <div class="grid2">
        <div>
          <label class="muted" style="font-weight:900">Exam date</label>
          <input class="input" name="examDate" data-date="1" value="${escapeHtml(examDate)}" placeholder="YYYY-MM-DD" required>
        </div>
        <div>
          <label class="muted" style="font-weight:900">Time</label>
          <input class="input" name="examTime" value="${escapeHtml(examTime)}" placeholder="HH:MM (optional)">
        </div>
      </div>

      <div class="grid2">
        <div>
          <label class="muted" style="font-weight:900">Status</label>
          <select name="status">
            <option value="scheduled" ${(existing?.status||"scheduled")==="scheduled"?"selected":""}>Scheduled</option>
            <option value="completed" ${(existing?.status||"scheduled")==="completed"?"selected":""}>Completed</option>
          </select>
        </div>
        <div></div>
      </div>
    `,
    onSubmit: async (fd) => {
      const subjectId = parseInt(fd.get("subjectId"),10);
      const title = (fd.get("title")||"").trim();
      const description = (fd.get("description")||"").trim();
      const examDate = (fd.get("examDate")||"").trim();
      const examTime = (fd.get("examTime")||"").trim();
      const status = fd.get("status") || "scheduled";

      if (!title) return toast("Enter title.", "error"), false;
      if (!examDate) return toast("Choose date.", "error"), false;

      if (isEdit) {
        existing.subjectId = subjectId;
        existing.title = title;
        existing.description = description;
        existing.examDate = examDate;
        existing.examTime = examTime;
        existing.status = status;
        await db.updateExam(existing);
      } else {
        await db.addExam({
          subjectId,
          title,
          description,
          examDate,
          examTime,
          status,
          dateAdded: isoToday()
        });
      }

      toast("Saved.");
      // refresh current page and calendar state
      await render("exams");
      return true;
    }
  });
}

/* ---------- EXPORTS (real) ---------- */
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
    exams: await db.listExams(),
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
  toast("Exported.");
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
  toast("Exported.");
}

async function exportXLSX() {
  if (!window.XLSX) return toast("XLSX not loaded.", "error");

  const subs = await subjectsMap();
  const topics = await db.listTopics();
  const topicsM = new Map(topics.map(t=>[t.id,t]));
  const revisions = await db.revisionsInRange("0000-01-01","9999-12-31");
  const homework = await db.listHomework();
  const exams = await db.listExams();

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

  const exRows = exams.map(e => {
    const s = subs.get(e.subjectId);
    return {
      Title: e.title,
      Subject: s?.name || "",
      "Exam Date": e.examDate,
      Time: e.examTime || "",
      Status: e.status || "scheduled",
      Details: e.description || ""
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revRows), "Revisions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hwRows), "Homework");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exRows), "Exams");

  const out = XLSX.write(wb, { bookType:"xlsx", type:"array" });
  downloadBlob("studyloop_data.xlsx", new Blob([out], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  toast("Exported.");
}

async function exportPDF() {
  const jspdf = window.jspdf;
  if (!jspdf) return toast("PDF not loaded.", "error");

  const { jsPDF } = jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });

  doc.setFont("helvetica","bold");
  doc.setFontSize(18);
  doc.text("StudyLoop Report", 40, 55);

  doc.setFont("helvetica","normal");
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 75);

  const exams = await db.listExams();
  const homework = await db.listHomework();
  const topics = await db.listTopics();
  const revs = await db.revisionsInRange("0000-01-01","9999-12-31");

  let y = 110;
  const line = (text) => { doc.text(text, 40, y); y += 18; };

  doc.setFont("helvetica","bold"); line("Summary");
  doc.setFont("helvetica","normal");
  line(`Topics: ${topics.length}`);
  line(`Revisions: ${revs.length}`);
  line(`Homework: ${homework.length}`);
  line(`Exams: ${exams.length}`);

  doc.save("studyloop_report.pdf");
  toast("Exported.");
}

/* ---------- Start ---------- */
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

  setPage("today");
}

start();
