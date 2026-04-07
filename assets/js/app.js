import { StudyLoopDB } from "./db.js";
import { isoToday, addDays, parseDaysCSV, nextWorkDay, scheduleRevisions } from "./scheduler.js";

const THEMES = ["Apple Light","Apple Dark","Neon Dark","Pastel Dream","Cyber Night","Glass Gradient","Slate Ember"];
const FONT_SUGGESTIONS = ["Inter","system-ui","Segoe UI","Roboto","Poppins","Montserrat","JetBrains Mono","Consolas","Arial"];
const SUBJECT_SWATCHES = ["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#85C1E9","#E67E22","#2ECC71","#9B59B6","#E74C3C","#3498DB"];

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function escapeHtml(s){ return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function currentPageName() {
  const page = $(".page.isVisible");
  return page ? page.id.replace("page-", "") : "today";
}

function countdownText(dateStr) {
  const diff = Math.ceil((new Date(dateStr + "T00:00:00") - new Date(isoToday() + "T00:00:00")) / 86400000);
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} ago`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff} days left`;
}

function parseChecklistText(text) {
  return String(text || "")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => ({ text: x, done: false }));
}

function checklistToText(items) {
  return (items || [])
    .map(x => typeof x === "string" ? x : x.text)
    .filter(Boolean)
    .join("\n");
}

function visibleOnly(arr) {
  return (arr || []).filter(x => !x.archived);
}

let db;

/* ---------------- Toast ---------------- */
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
  setTimeout(() => node.remove(), 1800);
}

/* ---------------- Overlay ---------------- */
let overlayHost;
function ensureOverlayHost(){
  if (overlayHost) return overlayHost;
  overlayHost = document.createElement("div");
  overlayHost.className = "overlayHost hidden";
  overlayHost.addEventListener("click", (e) => {
    if (e.target === overlayHost) closeOverlay();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });
  document.body.appendChild(overlayHost);
  return overlayHost;
}
function closeOverlay() {
  ensureOverlayHost();
  overlayHost.classList.add("hidden");
  overlayHost.innerHTML = "";
}
function openOverlay(node) {
  ensureOverlayHost();
  overlayHost.innerHTML = "";
  overlayHost.appendChild(node);
  overlayHost.classList.remove("hidden");
}

/* ---------------- Custom Select ---------------- */
function enhanceSelects(root){
  $$("select", root).forEach(sel => {
    if (sel.dataset.enhanced === "1") return;
    sel.dataset.enhanced = "1";

    const proxy = document.createElement("button");
    proxy.type = "button";
    proxy.className = "selectProxy";
    const style = sel.getAttribute("style");
    if (style) proxy.setAttribute("style", style);

    const sync = () => {
      const opt = sel.options[sel.selectedIndex];
      proxy.textContent = opt ? opt.text : "Select";
    };

    sync();
    sel.style.display = "none";
    sel.insertAdjacentElement("beforebegin", proxy);
    sel.addEventListener("change", sync);
    proxy.addEventListener("click", () => openSelectDropdown(sel, proxy));
  });
}

function openSelectDropdown(sel, anchorBtn){
  closeOverlay();

  const rect = anchorBtn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "dropdownMenu";
  menu.style.width = Math.max(rect.width, 220) + "px";

  [...sel.options].forEach((opt, i) => {
    const div = document.createElement("div");
    div.className = "dropdownItem" + (sel.selectedIndex === i ? " isSelected" : "");
    div.textContent = opt.text;

    div.addEventListener("click", () => {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    });

    menu.appendChild(div);
  });

  openOverlay(menu);

  const pad = 8;
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + pad;
  if (window.innerHeight - rect.bottom < menuRect.height + 16) {
    top = Math.max(16, rect.top - menuRect.height - pad);
  }
  const left = Math.min(rect.left, window.innerWidth - menuRect.width - 16);

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/* ---------------- Custom Date Picker ---------------- */
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

  const current = inputEl.value && /^\d{4}-\d{2}-\d{2}$/.test(inputEl.value) ? inputEl.value : isoToday();
  let base = new Date(current + "T00:00:00");
  let year = base.getFullYear();
  let month = base.getMonth();
  let selected = inputEl.value || "";

  const pop = document.createElement("div");
  pop.className = "datePopover";
  pop.style.width = "340px";

  const buildDays = (startDow, daysInMonth) => {
    const today = isoToday();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = i - startDow + 1;
      if (day < 1 || day > daysInMonth) {
        cells.push(`<div class="dateDay isMuted"></div>`);
      } else {
        const iso = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const cls = ["dateDay", iso === selected ? "isSelected" : "", iso === today ? "isToday" : ""].filter(Boolean).join(" ");
        cells.push(`<div class="${cls}" data-day="${iso}">${day}</div>`);
      }
    }
    return cells.join("");
  };

  const render = () => {
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    pop.innerHTML = `
      <div class="dateHead">
        <div class="dateHeadTitle">${first.toLocaleDateString(undefined, { month:"long", year:"numeric" })}</div>
        <div class="dateHeadBtns">
          <button class="dateMiniBtn" type="button" data-prev>◀</button>
          <button class="dateMiniBtn" type="button" data-next>▶</button>
          <button class="dateMiniBtn" type="button" data-today>Today</button>
          <button class="dateMiniBtn" type="button" data-clear>Clear</button>
        </div>
      </div>

      <div class="dateGrid">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<div class="dateDow">${d}</div>`).join("")}
        ${buildDays(startDow, daysInMonth)}
      </div>
    `;

    $("[data-prev]", pop).addEventListener("click", () => {
      month -= 1;
      if (month < 0) { month = 11; year -= 1; }
      render();
    });

    $("[data-next]", pop).addEventListener("click", () => {
      month += 1;
      if (month > 11) { month = 0; year += 1; }
      render();
    });

    $("[data-today]", pop).addEventListener("click", () => {
      inputEl.value = isoToday();
      inputEl.dispatchEvent(new Event("input", { bubbles:true }));
      inputEl.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    });

    $("[data-clear]", pop).addEventListener("click", () => {
      inputEl.value = "";
      inputEl.dispatchEvent(new Event("input", { bubbles:true }));
      inputEl.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    });

    $$("[data-day]", pop).forEach(btn => btn.addEventListener("click", () => {
      selected = btn.dataset.day;
      inputEl.value = selected;
      inputEl.dispatchEvent(new Event("input", { bubbles:true }));
      inputEl.dispatchEvent(new Event("change", { bubbles:true }));
      closeOverlay();
    }));
  };

  render();
  openOverlay(pop);

  const rect = inputEl.getBoundingClientRect();
  const pad = 8;
  const popRect = pop.getBoundingClientRect();
  let top = rect.bottom + pad;
  if (window.innerHeight - rect.bottom < popRect.height + 16) {
    top = Math.max(16, rect.top - popRect.height - pad);
  }
  const left = Math.min(rect.left, window.innerWidth - popRect.width - 16);

  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

/* ---------------- Color Controls ---------------- */
function enhanceColorControls(root){
  const hidden = $("input[name='color']", root);
  const custom = $("input[name='customColor']", root);
  const preview = $("[data-color-preview]", root);
  const swatches = $$(".colorSwatch", root);

  if (!hidden || !custom || !preview || !swatches.length) return;

  const sync = (value) => {
    hidden.value = value;
    custom.value = value;
    preview.style.background = value;
    swatches.forEach(b => b.classList.toggle("isSelected", b.dataset.color === value));
  };

  swatches.forEach(btn => btn.addEventListener("click", () => sync(btn.dataset.color)));
  custom.addEventListener("input", () => sync(custom.value));
  sync(hidden.value || custom.value || SUBJECT_SWATCHES[0]);
}

/* ---------------- Modal ---------------- */
function showModal({ title, body, onSubmit, submitText="Save", wide=false }) {
  const host = $("#modalHost");
  host.classList.remove("hidden");
  host.setAttribute("aria-hidden","false");
  host.innerHTML = "";

  const modal = el(`
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modalHeader">
        <div class="modalTitle">${escapeHtml(title)}</div>
        <button class="btn btnGhost" data-close>Close</button>
      </div>
      <form class="modalBody" data-form>
        ${body}
        <div class="modalFooter">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btnPrimary" data-submit>${escapeHtml(submitText)}</button>
        </div>
      </form>
    </div>
  `);

  host.appendChild(modal);
  enhanceSelects(modal);
  enhanceDateInputs(modal);
  enhanceColorControls(modal);

  const close = () => {
    host.classList.add("hidden");
    host.setAttribute("aria-hidden","true");
    host.innerHTML = "";
  };

  $$("[data-close]", host).forEach(b => b.addEventListener("click", close));
  host.addEventListener("click", (e) => { if (e.target === host) close(); }, { once:true });

  const form = $("[data-form]", host);
  const submitBtn = $("[data-submit]", host);
  let busy = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    busy = true;
    const oldText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    try {
      const ok = await onSubmit?.(new FormData(form));
      if (ok !== false) close();
    } catch (err) {
      console.error(err);
      toast(err?.message || "Something went wrong.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
      busy = false;
      return;
    }

    busy = false;
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
            <button class="btn ${danger ? "btnDanger" : "btnPrimary"}" type="button" data-ok>${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>
    `);

    host.appendChild(modal);

    const close = (result) => {
      host.classList.add("hidden");
      host.setAttribute("aria-hidden","true");
      host.innerHTML = "";
      resolve(result);
    };

    $("[data-close]", host).addEventListener("click", () => close(false));
    $("[data-cancel]", host).addEventListener("click", () => close(false));
    $("[data-ok]", host).addEventListener("click", () => close(true));
    host.addEventListener("click", (e) => { if (e.target === host) close(false); }, { once:true });
  });
}

function importModeModal() {
  return new Promise((resolve) => {
    const host = $("#modalHost");
    host.classList.remove("hidden");
    host.setAttribute("aria-hidden","false");
    host.innerHTML = "";

    const modal = el(`
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modalHeader">
          <div class="modalTitle">Import backup</div>
          <button class="btn btnGhost" data-close>Close</button>
        </div>
        <div class="modalBody">
          <div class="card" style="box-shadow:none">
            <div style="font-weight:900">Choose import mode</div>
          </div>
          <div class="modalFooter">
            <button class="btn" type="button" data-cancel>Cancel</button>
            <button class="btn" type="button" data-merge>Merge</button>
            <button class="btn btnDanger" type="button" data-replace>Replace</button>
          </div>
        </div>
      </div>
    `);

    host.appendChild(modal);

    const close = (result) => {
      host.classList.add("hidden");
      host.setAttribute("aria-hidden","true");
      host.innerHTML = "";
      resolve(result);
    };

    $("[data-close]", host).addEventListener("click", () => close(null));
    $("[data-cancel]", host).addEventListener("click", () => close(null));
    $("[data-merge]", host).addEventListener("click", () => close("merge"));
    $("[data-replace]", host).addEventListener("click", () => close("replace"));
    host.addEventListener("click", (e) => { if (e.target === host) close(null); }, { once:true });
  });
}

/* ---------------- Appearance ---------------- */
async function loadAppearance() {
  const theme = (await db.getSetting("theme")) || "Apple Light";
  const font = (await db.getSetting("font_family")) || "Inter";
  const size = (await db.getSetting("font_size")) || "13";
  applyAppearance({ theme, font, size });
}
function applyAppearance({ theme, font, size }) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--font-family", font);
  document.documentElement.style.setProperty("--font-size", `${parseInt(size, 10) || 13}px`);
}

/* ---------------- SW ---------------- */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          $("#updateBanner")?.classList.remove("hidden");
        }
      });
    });

    $("#reloadBtn")?.addEventListener("click", () => location.reload());
  } catch {}
}

/* ---------------- Navigation ---------------- */
function setPage(pageName) {
  $$(".navItem").forEach(b => b.classList.toggle("isActive", b.dataset.page === pageName));
  $$(".page").forEach(p => p.classList.remove("isVisible"));
  $(`#page-${pageName}`)?.classList.add("isVisible");
  render(pageName);
}
$$(".navItem").forEach(b => b.addEventListener("click", () => setPage(b.dataset.page)));

/* ---------------- Data Helpers ---------------- */
async function subjectsMap() {
  const subs = await db.listSubjects();
  return new Map(subs.map(s => [s.id, s]));
}
async function topicsMap() {
  const topics = await db.listTopics();
  return new Map(topics.map(t => [t.id, t]));
}

/* ---------------- Archive Helpers ---------------- */
async function updateTopicArchive(topicId) {
  const topic = await db.getTopic(topicId);
  if (!topic) return;
  const revs = await db.listRevisionsByTopic(topicId);
  const allFinished = revs.length > 0 && revs.every(r => r.status === "done" || r.status === "skipped");
  topic.archived = allFinished;
  await db.updateTopic(topic);
}
async function autoArchiveHomework(hw) {
  hw.archived = hw.status === "completed";
  await db.updateHomework(hw);
}
async function autoArchiveExam(exam) {
  exam.archived = (exam.status || "scheduled") === "completed";
  await db.updateExam(exam);
}

/* ---------------- Carry Forward ---------------- */
async function checkCarryForward() {
  const last = await db.getSetting("last_opened");
  const today = isoToday();
  await db.setSetting("last_opened", today);

  if (!last || last >= today) return;
  const yesterday = addDays(today, -1);
  if (last >= yesterday) return;

  const missed = await db.pendingRevisionsInRange(addDays(last, 1), yesterday);
  if (!missed.length) return;

  showModal({
    title: "Missed revisions",
    submitText: "Apply",
    body: `
      <div class="card" style="box-shadow:none">
        <div style="font-weight:950">${missed.length} pending revision(s)</div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <label class="row" style="font-weight:900"><input type="radio" name="mode" value="all" checked> Load all today</label>
          <label class="row" style="font-weight:900"><input type="radio" name="mode" value="spread"> Spread with cap</label>
        </div>
      </div>
    `,
    onSubmit: async (fd) => {
      const mode = fd.get("mode");
      const holidaySet = new Set((await db.listHolidays()).map(h => h.date));
      const weeklyOffSet = new Set(((await db.getSetting("weekly_holidays")) || "").split(",").map(x => parseInt(x, 10)).filter(Number.isFinite));
      const cap = Math.max(20, Math.min(30, parseInt((await db.getSetting("carry_forward_cap")) || "25", 10) || 25));

      if (mode === "all") {
        const target = nextWorkDay(today, holidaySet, weeklyOffSet);
        for (const r of missed) {
          r.scheduledDate = target;
          await db.updateRevision(r);
        }
      } else {
        const assigned = new Map();
        for (const r of missed) {
          let d = today;
          while (true) {
            d = nextWorkDay(d, holidaySet, weeklyOffSet);
            const existing = (await db.listPendingRevisionsByDate(d)).length + (assigned.get(d) || 0);
            if (existing < cap) {
              assigned.set(d, (assigned.get(d) || 0) + 1);
              r.scheduledDate = d;
              await db.updateRevision(r);
              break;
            }
            d = addDays(d, 1);
          }
        }
      }

      toast("Updated.");
      await render("today");
      return true;
    }
  });
}

/* ---------------- Calendar Indicator ---------------- */
async function calendarIndicatorHTML(r, h, e) {
  const mode = (await db.getSetting("calendar_indicator_mode")) || "both";
  const labels = [];
  if (r) labels.push(`${r}R`);
  if (h) labels.push(`${h}H`);
  if (e) labels.push(`${e}E`);

  const dots = `
    <div class="indicatorRow">
      ${r ? `<span class="indicatorDot dotRev"></span>` : ""}
      ${h ? `<span class="indicatorDot dotHW"></span>` : ""}
      ${e ? `<span class="indicatorDot dotExam"></span>` : ""}
    </div>
  `;

  if (mode === "dots") return dots;
  if (mode === "labels") return `<div class="calCounts">${labels.join(" ")}</div>`;
  return `${dots}<div class="calCounts">${labels.join(" ")}</div>`;
}

/* ---------------- Dispatcher ---------------- */
async function render(pageName) {
  closeOverlay();
  switch(pageName){
    case "today": return renderToday();
    case "calendar": return renderCalendar();
    case "upcoming": return renderUpcoming();
    case "topics": return renderTopics();
    case "homework": return renderHomework();
    case "exams": return renderExams();
    case "archive": return renderArchive();
    case "subjects": return renderSubjects();
    case "dashboard": return renderDashboard();
    case "settings": return renderSettings();
  }
}

/* ---------------- Today ---------------- */
async function renderToday() {
  const host = $("#page-today");
  const today = isoToday();
  const subs = await subjectsMap();
  const tMap = await topicsMap();

  const revsAll = await db.listRevisionsByDate(today);
  const revs = revsAll.filter(r => {
    const tp = tMap.get(r.topicId);
    return tp && !tp.archived;
  });
  const pending = revs.filter(r => r.status === "pending");

  const hwToday = visibleOnly(await db.listHomeworkByDate(today)).filter(h => h.status === "pending");
  const overdueHW = visibleOnly(await db.listHomework({ status:"pending" })).filter(h => h.dueDate < today);

  const exams = visibleOnly(await db.listExams({ status:"scheduled" })).filter(e => e.examDate >= today).slice(0, 4);

  host.innerHTML = `
    <h1 class="pageTitle">Today</h1>
    <div class="pageSub">${new Date().toLocaleDateString(undefined,{ weekday:"long", year:"numeric", month:"long", day:"numeric" })}</div>

    <div class="row" style="gap:10px; margin-bottom:12px; flex-wrap:wrap">
      <button class="btn btnPrimary" id="addTopicBtn">Add Topic</button>
      <button class="btn btnPrimary" id="addHwBtn">Add Homework</button>
      <button class="btn btnPrimary" id="addExamBtn">Add Exam</button>
    </div>

    <div class="grid2">
      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Revisions</div>
            <div class="smallMeta">${pending.length} pending</div>
          </div>
        </div>
        <div class="list" id="todayRevList"></div>
      </div>

      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">Exam Countdown</div>
          </div>
        </div>
        <div class="list" id="todayExamList"></div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">Homework</div>
          <div class="smallMeta">${hwToday.length} due • ${overdueHW.length} overdue</div>
        </div>
      </div>
      <div class="list" id="todayHwList"></div>
    </div>
  `;

  $("#addTopicBtn").addEventListener("click", () => openTopicModal());
  $("#addHwBtn").addEventListener("click", () => openHomeworkModal());
  $("#addExamBtn").addEventListener("click", () => openExamModal());

  const revList = $("#todayRevList");
  if (!revs.length) {
    revList.appendChild(el(`<div class="smallMeta">No revisions.</div>`));
  } else {
    for (const r of revs) {
      const tp = tMap.get(r.topicId);
      const subj = subs.get(tp.subjectId);
      revList.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp.name)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} • ${r.status.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            ${r.status === "pending"
              ? `<button class="btn btnPrimary" data-rdone="${r.id}">Done</button><button class="btn" data-rskip="${r.id}">Skip</button>`
              : `<button class="btn" data-rundo="${r.id}">Undone</button>`}
          </div>
        </div>
      `));
    }
  }

  $$("[data-rdone]", revList).forEach(b => b.addEventListener("click", async () => {
    const rev = await db.getRevision(parseInt(b.dataset.rdone, 10));
    rev.status = "done";
    await db.updateRevision(rev);
    await updateTopicArchive(rev.topicId);
    await renderToday();
  }));
  $$("[data-rskip]", revList).forEach(b => b.addEventListener("click", async () => {
    const rev = await db.getRevision(parseInt(b.dataset.rskip, 10));
    rev.status = "skipped";
    await db.updateRevision(rev);
    await updateTopicArchive(rev.topicId);
    await renderToday();
  }));
  $$("[data-rundo]", revList).forEach(b => b.addEventListener("click", async () => {
    const rev = await db.getRevision(parseInt(b.dataset.rundo, 10));
    rev.status = "pending";
    await db.updateRevision(rev);
    await updateTopicArchive(rev.topicId);
    await renderToday();
  }));

  const examList = $("#todayExamList");
  if (!exams.length) {
    examList.appendChild(el(`<div class="smallMeta">No upcoming exams.</div>`));
  } else {
    for (const ex of exams) {
      const subj = subs.get(ex.subjectId);
      const c = countdownText(ex.examDate);
      examList.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(ex.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${ex.examDate}${ex.examTime ? " • " + ex.examTime : ""}</div>
            </div>
          </div>
          <div class="countdownBadge ${c.includes("ago") ? "countdownDanger" : ""}">${escapeHtml(c)}</div>
        </div>
      `));
    }
  }

  const hwList = $("#todayHwList");
  const mergedHW = [...overdueHW, ...hwToday.filter(h => !overdueHW.some(x => x.id === h.id))];
  if (!mergedHW.length) {
    hwList.appendChild(el(`<div class="smallMeta">No homework.</div>`));
  } else {
    for (const hw of mergedHW) {
      const subj = subs.get(hw.subjectId);
      const overdue = hw.dueDate < today && hw.status === "pending";
      hwList.appendChild(el(`
        <div class="item ${overdue ? "overdue" : ""}">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(hw.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${hw.dueDate} • ${hw.priority.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" data-hdone="${hw.id}">Done</button>
            <button class="btn" data-hedit="${hw.id}">Edit</button>
            <button class="btn btnDanger" data-hdel="${hw.id}">Delete</button>
          </div>
        </div>
      `));
    }
  }

  $$("[data-hdone]", hwList).forEach(b => b.addEventListener("click", async () => {
    const hw = await db.getHomework(parseInt(b.dataset.hdone, 10));
    hw.status = "completed";
    await autoArchiveHomework(hw);
    await renderToday();
  }));
  $$("[data-hedit]", hwList).forEach(b => b.addEventListener("click", async () => {
    const hw = await db.getHomework(parseInt(b.dataset.hedit, 10));
    openHomeworkModal(hw);
  }));
  $$("[data-hdel]", hwList).forEach(b => b.addEventListener("click", async () => {
    const ok = await confirmModal({ title:"Delete homework", message:"Delete this homework?", confirmText:"Delete", danger:true });
    if (!ok) return;
    await db.deleteHomework(parseInt(b.dataset.hdel, 10));
    await renderToday();
  }));

  await db.logDay(today, pending.length === 0);
}

/* ---------------- Calendar ---------------- */
function monthInfo(year, month1to12) {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const startDow = (first.getUTCDay() + 6) % 7;
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

  const topicMap = await topicsMap();
  const revs = await db.revisionsInRange(`${monthPrefix}-01`, `${monthPrefix}-31`);
  const hws = visibleOnly(await db.listHomework());
  const exs = visibleOnly(await db.listExams());

  const revCount = new Map();
  const hwCount = new Map();
  const exCount = new Map();

  for (const r of revs) {
    const tp = topicMap.get(r.topicId);
    if (!tp || tp.archived || r.status !== "pending") continue;
    revCount.set(r.scheduledDate, (revCount.get(r.scheduledDate) || 0) + 1);
  }
  for (const h of hws) {
    if (h.status !== "pending" || !h.dueDate.startsWith(monthPrefix)) continue;
    hwCount.set(h.dueDate, (hwCount.get(h.dueDate) || 0) + 1);
  }
  for (const e of exs) {
    if ((e.status || "scheduled") !== "scheduled" || !e.examDate.startsWith(monthPrefix)) continue;
    exCount.set(e.examDate, (exCount.get(e.examDate) || 0) + 1);
  }

  host.innerHTML = `
    <h1 class="pageTitle">Calendar</h1>
    <div class="card">
      <div class="rowBetween">
        <div class="row" style="gap:10px">
          <button class="btn" id="calPrev">Previous</button>
          <button class="btn" id="calNext">Next</button>
        </div>
        <div style="font-weight:950">${new Date(Date.UTC(calYear, calMonth - 1, 1)).toLocaleDateString(undefined, { month:"long", year:"numeric" })}</div>
        <button class="btn btnPrimary" id="calAddExam">Add Exam</button>
      </div>

      <hr class="sep">
      <div class="calendarGrid" style="margin-bottom:10px">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<div class="calDow">${d}</div>`).join("")}</div>
      <div class="calendarGrid" id="calGrid"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader">
        <div><div class="cardTitle">Selected: ${calSelected}</div></div>
      </div>
      <div class="list" id="calDetails"></div>
    </div>
  `;

  $("#calPrev").addEventListener("click", () => {
    calMonth -= 1;
    if (calMonth === 0) { calMonth = 12; calYear -= 1; }
    renderCalendar();
  });
  $("#calNext").addEventListener("click", () => {
    calMonth += 1;
    if (calMonth === 13) { calMonth = 1; calYear += 1; }
    renderCalendar();
  });
  $("#calAddExam").addEventListener("click", () => openExamModal(null, calSelected));

  const grid = $("#calGrid");
  for (let i = 0; i < 42; i++) {
    const day = i - startDow + 1;
    if (day < 1 || day > daysInMonth) {
      grid.appendChild(el(`<div style="min-height:72px"></div>`));
      continue;
    }
    const iso = `${monthPrefix}-${String(day).padStart(2,"0")}`;
    const indicators = await calendarIndicatorHTML(revCount.get(iso) || 0, hwCount.get(iso) || 0, exCount.get(iso) || 0);
    const cell = el(`
      <div class="calCell ${iso === calSelected ? "isSelected" : ""}" data-date="${iso}">
        <div class="calDay">${day}</div>
        ${indicators}
      </div>
    `);
    cell.addEventListener("click", () => {
      calSelected = iso;
      renderCalendar();
    });
    grid.appendChild(cell);
  }

  await renderCalendarDetails();
}

async function renderCalendarDetails() {
  const list = $("#calDetails");
  list.innerHTML = "";

  const subs = await subjectsMap();
  const tMap = await topicsMap();

  const revs = (await db.listRevisionsByDate(calSelected)).filter(r => {
    const tp = tMap.get(r.topicId);
    return tp && !tp.archived;
  });
  const hws = visibleOnly(await db.listHomeworkByDate(calSelected));
  const exs = visibleOnly(await db.listExamsByDate(calSelected));

  if (!revs.length && !hws.length && !exs.length) {
    list.appendChild(el(`<div class="smallMeta">Nothing scheduled.</div>`));
    return;
  }

  for (const ex of exs) {
    const subj = subs.get(ex.subjectId);
    const c = countdownText(ex.examDate);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(ex.title)}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${ex.examDate}${ex.examTime ? " • " + ex.examTime : ""}</div>
          </div>
        </div>
        <div class="row">
          <div class="countdownBadge ${c.includes("ago") ? "countdownDanger" : ""}">${escapeHtml(c)}</div>
          <button class="btn" data-exedit="${ex.id}">Edit</button>
        </div>
      </div>
    `));
  }

  $$("[data-exedit]", list).forEach(b => b.addEventListener("click", async () => {
    const ex = await db.getExam(parseInt(b.dataset.exedit, 10));
    openExamModal(ex);
  }));

  for (const r of revs) {
    const tp = tMap.get(r.topicId);
    const subj = subs.get(tp.subjectId);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(tp.name)}</div>
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum} • ${r.status.toUpperCase()}</div>
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
            <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${h.priority.toUpperCase()} • ${h.status.toUpperCase()}</div>
          </div>
        </div>
      </div>
    `));
  }
}

/* ---------------- Upcoming ---------------- */
async function renderUpcoming() {
  const host = $("#page-upcoming");
  const subs = await subjectsMap();
  const tMap = await topicsMap();
  const today = isoToday();

  host.innerHTML = `<h1 class="pageTitle">Upcoming</h1><div class="list" id="upList"></div>`;
  const list = $("#upList");

  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const revs = (await db.listPendingRevisionsByDate(d)).filter(r => {
      const tp = tMap.get(r.topicId);
      return tp && !tp.archived;
    });
    const hws = visibleOnly(await db.listHomeworkByDate(d)).filter(h => h.status === "pending");
    const exs = visibleOnly(await db.listExamsByDate(d)).filter(e => (e.status || "scheduled") === "scheduled");

    list.appendChild(el(`
      <div class="card" style="box-shadow:none">
        <div class="rowBetween">
          <div style="font-weight:950">${d}</div>
          <div class="smallMeta">${revs.length}R • ${hws.length}H • ${exs.length}E</div>
        </div>
      </div>
    `));

    if (!revs.length && !hws.length && !exs.length) {
      list.appendChild(el(`<div class="smallMeta" style="padding:0 12px 12px 12px">Nothing.</div>`));
      continue;
    }

    for (const ex of exs) {
      const subj = subs.get(ex.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(ex.title)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${countdownText(ex.examDate)}</div>
            </div>
          </div>
        </div>
      `));
    }

    for (const r of revs) {
      const tp = tMap.get(r.topicId);
      const subj = subs.get(tp.subjectId);
      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subj?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp.name)}</div>
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • Rev ${r.revisionNum}</div>
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
              <div class="itemMeta">${escapeHtml(subj?.name || "Subject")} • ${h.priority.toUpperCase()}</div>
            </div>
          </div>
        </div>
      `));
    }
  }
}

/* ---------------- Topics ---------------- */
async function renderTopics() {
  const host = $("#page-topics");
  const subjects = await db.listSubjects();

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
  subjects.forEach(s => subjSel.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`)));
  enhanceSelects(host);

  $("#tpAdd").addEventListener("click", () => openTopicModal());
  $("#tpSearch").addEventListener("input", renderTopicList);
  $("#tpSubj").addEventListener("change", renderTopicList);

  async function renderTopicList() {
    const search = $("#tpSearch").value.trim() || null;
    const sid = $("#tpSubj").value ? parseInt($("#tpSubj").value, 10) : null;
    const topics = visibleOnly(await db.listTopics({ subjectId:sid, search }));
    const subs = await subjectsMap();
    const list = $("#tpList");
    list.innerHTML = "";

    if (!topics.length) {
      list.appendChild(el(`<div class="smallMeta">No topics.</div>`));
      return;
    }

    for (const tp of topics) {
      const revs = await db.listRevisionsByTopic(tp.id);
      const done = revs.filter(r => r.status === "done").length;
      const hasNotes = !!(tp.notesText || (tp.notesChecklist || []).length);

      list.appendChild(el(`
        <div class="item">
          <div class="itemLeft">
            <span class="badge" style="background:${subs.get(tp.subjectId)?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(tp.name)}</div>
              <div class="itemMeta">${escapeHtml(subs.get(tp.subjectId)?.name || "Subject")} • ${tp.dateAdded} • ${done}/${revs.length}${hasNotes ? " • Notes" : ""}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn" data-edit="${tp.id}">Edit</button>
            <button class="btn btnDanger" data-del="${tp.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-edit]", list).forEach(b => b.addEventListener("click", async () => {
      const tp = await db.getTopic(parseInt(b.dataset.edit, 10));
      openTopicModal(tp);
    }));

    $$("[data-del]", list).forEach(b => b.addEventListener("click", async () => {
      const tp = await db.getTopic(parseInt(b.dataset.del, 10));
      const ok = await confirmModal({ title:"Delete topic", message:`Delete "${tp.name}"?`, confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteTopic(tp.id);
      renderTopicList();
    }));
  }

  renderTopicList();
}

/* ---------------- Homework ---------------- */
async function renderHomework() {
  const host = $("#page-homework");
  const subjects = await db.listSubjects();
  const subs = new Map(subjects.map(s => [s.id, s]));
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
  subjects.forEach(s => subjSel.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`)));
  enhanceSelects(host);

  $("#hwAdd").addEventListener("click", () => openHomeworkModal());
  $("#hwSubj").addEventListener("change", renderList);
  $("#hwStatus").addEventListener("change", renderList);

  async function renderList() {
    const sid = $("#hwSubj").value ? parseInt($("#hwSubj").value, 10) : null;
    const status = $("#hwStatus").value || null;
    const items = visibleOnly(await db.listHomework({ subjectId:sid, status }));
    const list = $("#hwList");
    list.innerHTML = "";

    if (!items.length) {
      list.appendChild(el(`<div class="smallMeta">No homework.</div>`));
      return;
    }

    for (const hw of items) {
      const overdue = hw.status === "pending" && hw.dueDate < today;
      list.appendChild(el(`
        <div class="item ${overdue ? "overdue" : ""}">
          <div class="itemLeft">
            <span class="badge" style="background:${subs.get(hw.subjectId)?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(hw.title)}</div>
              <div class="itemMeta">${escapeHtml(subs.get(hw.subjectId)?.name || "Subject")} • ${hw.dueDate} • ${hw.priority.toUpperCase()} • ${hw.status.toUpperCase()}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn btnPrimary" data-toggle="${hw.id}">${hw.status === "pending" ? "Done" : "Pending"}</button>
            <button class="btn" data-edit="${hw.id}">Edit</button>
            <button class="btn btnDanger" data-del="${hw.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-toggle]", list).forEach(b => b.addEventListener("click", async () => {
      const hw = await db.getHomework(parseInt(b.dataset.toggle, 10));
      hw.status = hw.status === "pending" ? "completed" : "pending";
      if (hw.status === "completed") await autoArchiveHomework(hw);
      else {
        hw.archived = false;
        await db.updateHomework(hw);
      }
      renderList();
    }));

    $$("[data-edit]", list).forEach(b => b.addEventListener("click", async () => {
      const hw = await db.getHomework(parseInt(b.dataset.edit, 10));
      openHomeworkModal(hw);
    }));

    $$("[data-del]", list).forEach(b => b.addEventListener("click", async () => {
      const ok = await confirmModal({ title:"Delete homework", message:"Delete this homework?", confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteHomework(parseInt(b.dataset.del, 10));
      renderList();
    }));
  }

  renderList();
}

/* ---------------- Exams ---------------- */
async function renderExams() {
  const host = $("#page-exams");
  const subjects = await db.listSubjects();
  const subs = new Map(subjects.map(s => [s.id, s]));

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
  subjects.forEach(s => subjSel.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`)));
  enhanceSelects(host);

  $("#exAdd").addEventListener("click", () => openExamModal());
  $("#exSubj").addEventListener("change", renderList);
  $("#exStatus").addEventListener("change", renderList);

  async function renderList() {
    const sid = $("#exSubj").value ? parseInt($("#exSubj").value, 10) : null;
    const status = $("#exStatus").value || null;
    const items = visibleOnly(await db.listExams({ subjectId:sid, status }));
    const list = $("#exList");
    list.innerHTML = "";

    if (!items.length) {
      list.appendChild(el(`<div class="smallMeta">No exams.</div>`));
      return;
    }

    for (const ex of items) {
      const c = countdownText(ex.examDate);
      const linkedCount = (ex.linkedTopicIds || []).length;
      list.appendChild(el(`
        <div class="item ${c.includes("ago") && (ex.status || "scheduled") === "scheduled" ? "overdue" : ""}">
          <div class="itemLeft">
            <span class="badge" style="background:${subs.get(ex.subjectId)?.color || "#999"}"></span>
            <div class="itemMain">
              <div class="itemTitle">${escapeHtml(ex.title)}</div>
              <div class="itemMeta">
                ${escapeHtml(subs.get(ex.subjectId)?.name || "Subject")} • ${ex.examDate}${ex.examTime ? " • " + ex.examTime : ""}
                • ${(ex.priority || "medium").toUpperCase()}
                • ${ex.syllabusCoverage || 0}% syllabus
                • ${ex.targetHours || 0}h
                ${linkedCount ? ` • ${linkedCount} linked topics` : ""}
              </div>
            </div>
          </div>
          <div class="row">
            <div class="countdownBadge ${c.includes("ago") ? "countdownDanger" : ""}">${escapeHtml(c)}</div>
            <button class="btn btnPrimary" data-toggle="${ex.id}">${(ex.status || "scheduled") === "scheduled" ? "Done" : "Scheduled"}</button>
            <button class="btn" data-edit="${ex.id}">Edit</button>
            <button class="btn btnDanger" data-del="${ex.id}">Delete</button>
          </div>
        </div>
      `));
    }

    $$("[data-toggle]", list).forEach(b => b.addEventListener("click", async () => {
      const ex = await db.getExam(parseInt(b.dataset.toggle, 10));
      ex.status = (ex.status || "scheduled") === "scheduled" ? "completed" : "scheduled";
      if (ex.status === "completed") await autoArchiveExam(ex);
      else {
        ex.archived = false;
        await db.updateExam(ex);
      }
      renderList();
    }));

    $$("[data-edit]", list).forEach(b => b.addEventListener("click", async () => {
      const ex = await db.getExam(parseInt(b.dataset.edit, 10));
      openExamModal(ex);
    }));

    $$("[data-del]", list).forEach(b => b.addEventListener("click", async () => {
      const ok = await confirmModal({ title:"Delete exam", message:"Delete this exam?", confirmText:"Delete", danger:true });
      if (!ok) return;
      await db.deleteExam(parseInt(b.dataset.del, 10));
      renderList();
    }));
  }

  renderList();
}

/* ---------------- Archive ---------------- */
async function renderArchive() {
  const host = $("#page-archive");
  const subs = await subjectsMap();

  const topics = (await db.listTopics()).filter(t => t.archived);
  const homework = (await db.listHomework()).filter(h => h.archived);
  const exams = (await db.listExams()).filter(e => e.archived);

  host.innerHTML = `
    <h1 class="pageTitle">Archive</h1>
    <div class="card">
      <div class="list" id="archiveList"></div>
    </div>
  `;

  const list = $("#archiveList");

  if (!topics.length && !homework.length && !exams.length) {
    list.appendChild(el(`<div class="smallMeta">Archive is empty.</div>`));
    return;
  }

  for (const tp of topics) {
    const subj = subs.get(tp.subjectId);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(tp.name)}</div>
            <div class="itemMeta">Topic • ${escapeHtml(subj?.name || "Subject")}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-tr="${tp.id}">Restore</button>
        </div>
      </div>
    `));
  }

  for (const hw of homework) {
    const subj = subs.get(hw.subjectId);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(hw.title)}</div>
            <div class="itemMeta">Homework • ${escapeHtml(subj?.name || "Subject")}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-hr="${hw.id}">Restore</button>
        </div>
      </div>
    `));
  }

  for (const ex of exams) {
    const subj = subs.get(ex.subjectId);
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${subj?.color || "#999"}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(ex.title)}</div>
            <div class="itemMeta">Exam • ${escapeHtml(subj?.name || "Subject")}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-er="${ex.id}">Restore</button>
        </div>
      </div>
    `));
  }

  $$("[data-tr]", list).forEach(b => b.addEventListener("click", async () => {
    const tp = await db.getTopic(parseInt(b.dataset.tr, 10));
    tp.archived = false;
    await db.updateTopic(tp);
    renderArchive();
  }));
  $$("[data-hr]", list).forEach(b => b.addEventListener("click", async () => {
    const hw = await db.getHomework(parseInt(b.dataset.hr, 10));
    hw.archived = false;
    await db.updateHomework(hw);
    renderArchive();
  }));
  $$("[data-er]", list).forEach(b => b.addEventListener("click", async () => {
    const ex = await db.getExam(parseInt(b.dataset.er, 10));
    ex.archived = false;
    await db.updateExam(ex);
    renderArchive();
  }));
}

/* ---------------- Subjects ---------------- */
async function renderSubjects() {
  const host = $("#page-subjects");
  const subjects = await db.listSubjects();

  host.innerHTML = `
    <h1 class="pageTitle">Subjects</h1>
    <div class="row" style="gap:10px; margin-bottom:12px">
      <button class="btn btnPrimary" id="subAdd">Add Subject</button>
    </div>
    <div class="card">
      <div class="list" id="subList"></div>
    </div>
  `;

  $("#subAdd").addEventListener("click", () => openSubjectModal());

  const list = $("#subList");
  if (!subjects.length) {
    list.appendChild(el(`<div class="smallMeta">No subjects.</div>`));
    return;
  }

  for (const s of subjects) {
    list.appendChild(el(`
      <div class="item">
        <div class="itemLeft">
          <span class="badge" style="background:${s.color}"></span>
          <div class="itemMain">
            <div class="itemTitle">${escapeHtml(s.name)}</div>
            <div class="itemMeta">${s.revisionDays?.length ? s.revisionDays.join(", ") : "Global revision days"}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn" data-edit="${s.id}">Edit</button>
          <button class="btn btnDanger" data-del="${s.id}">Delete</button>
        </div>
      </div>
    `));
  }

  $$("[data-edit]", list).forEach(b => b.addEventListener("click", async () => {
    const s = await db.getSubject(parseInt(b.dataset.edit, 10));
    openSubjectModal(s);
  }));

  $$("[data-del]", list).forEach(b => b.addEventListener("click", async () => {
    const s = await db.getSubject(parseInt(b.dataset.del, 10));
    const ok = await confirmModal({ title:"Delete subject", message:`Delete "${s.name}"?`, confirmText:"Delete", danger:true });
    if (!ok) return;
    await db.deleteSubject(s.id);
    renderSubjects();
  }));
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard() {
  const host = $("#page-dashboard");

  host.innerHTML = `
    <h1 class="pageTitle">Dashboard</h1>
    <div class="segment" style="margin-bottom:12px">
      <button class="segBtn" id="segWeek" aria-pressed="true">Week</button>
      <button class="segBtn" id="segMonth" aria-pressed="false">Month</button>
    </div>

    <div class="grid4" id="dashCards"></div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader"><div class="cardTitle" id="chartTitle">Revisions</div></div>
      <div id="revChart"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardHeader"><div class="cardTitle">Subject Analytics</div></div>
      <div class="list" id="subjectAnalytics"></div>
    </div>
  `;

  let mode = "week";
  const setMode = (m) => {
    mode = m;
    $("#segWeek").setAttribute("aria-pressed", m === "week" ? "true" : "false");
    $("#segMonth").setAttribute("aria-pressed", m === "month" ? "true" : "false");
    renderDashMode(mode);
  };

  $("#segWeek").addEventListener("click", () => setMode("week"));
  $("#segMonth").addEventListener("click", () => setMode("month"));

  await renderDashMode("week");
}

async function renderDashMode(mode) {
  const today = isoToday();
  const start = mode === "week"
    ? addDays(today, -((new Date(today + "T00:00:00").getDay() + 6) % 7))
    : `${today.slice(0,8)}01`;

  const topics = visibleOnly(await db.listTopics());
  const topicCount = topics.filter(t => t.dateAdded >= start && t.dateAdded <= today).length;

  const tMap = await topicsMap();
  const revsRaw = await db.revisionsInRange(start, today);
  const revs = revsRaw.filter(r => {
    const tp = tMap.get(r.topicId);
    return tp && !tp.archived;
  });

  const total = revs.length;
  const done = revs.filter(r => r.status === "done").length;
  const rate = total ? Math.round((done / total) * 1000) / 10 : 0;

  let streak = 0;
  let d = today;
  while (true) {
    const log = await db.getDailyLog(d);
    if (log && log.allCompleted) {
      streak += 1;
      d = addDays(d, -1);
    } else break;
  }

  const exCount = visibleOnly(await db.listExams({ status:"scheduled" })).filter(e => e.examDate >= today).length;

  const cards = $("#dashCards");
  cards.innerHTML = "";
  const card = (title, value) => el(`
    <div class="card" style="box-shadow:var(--shadow2)">
      <div class="smallMeta">${escapeHtml(title)}</div>
      <div style="font-size:28px;font-weight:950">${escapeHtml(value)}</div>
    </div>
  `);
  cards.appendChild(card("Topics", topicCount));
  cards.appendChild(card("Revisions", `${done}/${total}`));
  cards.appendChild(card("Rate", `${rate}%`));
  cards.appendChild(card("Exams", exCount));
  cards.appendChild(card("Streak", streak));

  $("#chartTitle").textContent = mode === "week" ? "Revisions This Week" : "Revisions This Month";

  const days = [];
  if (mode === "week") {
    for (let i = 0; i < 7; i++) days.push(addDays(start, i));
  } else {
    const endDay = parseInt(today.slice(8,10), 10);
    for (let i = 1; i <= endDay; i++) days.push(`${today.slice(0,8)}${String(i).padStart(2,"0")}`);
  }

  const counts = new Map();
  const countsDone = new Map();
  for (const r of revs) {
    counts.set(r.scheduledDate, (counts.get(r.scheduledDate) || 0) + 1);
    if (r.status === "done") countsDone.set(r.scheduledDate, (countsDone.get(r.scheduledDate) || 0) + 1);
  }

  const max = Math.max(1, ...days.map(d => counts.get(d) || 0));
  const chart = el(`<div class="row" style="align-items:flex-end;gap:10px;overflow:auto;padding-bottom:6px"></div>`);

  days.forEach(d => {
    const tot = counts.get(d) || 0;
    const dn = countsDone.get(d) || 0;
    const h = tot ? Math.round((tot / max) * 140) : 4;
    const h2 = dn ? Math.round((dn / max) * 140) : 0;
    const label = mode === "week"
      ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday:"short" })
      : String(parseInt(d.slice(8,10), 10));

    chart.appendChild(el(`
      <div style="min-width:34px;text-align:center">
        <div style="height:150px;display:flex;align-items:flex-end;justify-content:center">
          <div style="width:18px;height:${h}px;border-radius:10px;background:rgba(127,127,127,.35);position:relative;overflow:hidden">
            <div style="position:absolute;bottom:0;left:0;right:0;height:${h2}px;background:var(--primary);border-radius:10px"></div>
          </div>
        </div>
        <div class="smallMeta">${label}</div>
      </div>
    `));
  });

  const revChart = $("#revChart");
  revChart.innerHTML = "";
  revChart.appendChild(chart);

  const subs = await db.listSubjects();
  const analytics = $("#subjectAnalytics");
  analytics.innerHTML = "";

  const subjectStats = subs.map(s => ({ id:s.id, name:s.name, color:s.color, total:0, done:0, topics:0 }));
  topics.forEach(tp => {
    const row = subjectStats.find(x => x.id === tp.subjectId);
    if (row) row.topics += 1;
  });
  revs.forEach(r => {
    const tp = tMap.get(r.topicId);
    const row = subjectStats.find(x => x.id === tp.subjectId);
    if (!row) return;
    row.total += 1;
    if (r.status === "done") row.done += 1;
  });

  if (!subjectStats.length) {
    analytics.appendChild(el(`<div class="smallMeta">No subject data.</div>`));
  } else {
    subjectStats.forEach(s => {
      const percent = s.total ? Math.round((s.done / s.total) * 100) : 0;
      analytics.appendChild(el(`
        <div>
          <div class="rowBetween" style="margin-bottom:6px">
            <div class="row">
              <span class="badge" style="background:${s.color}"></span>
              <div style="font-weight:900">${escapeHtml(s.name)}</div>
            </div>
            <div class="smallMeta">${s.done}/${s.total} • ${percent}% • ${s.topics} topics</div>
          </div>
          <div class="barTrack"><div class="barFill" style="width:${percent}%"></div></div>
        </div>
      `));
    });
  }
}

/* ---------------- Settings ---------------- */
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
  const indicatorMode = (await db.getSetting("calendar_indicator_mode")) || "both";
  const carryCap = Math.max(20, Math.min(30, parseInt((await db.getSetting("carry_forward_cap")) || "25", 10) || 25));
  const weekly = (await db.getSetting("weekly_holidays")) || "";
  const weeklySet = new Set(weekly.split(",").map(x => parseInt(x, 10)).filter(Number.isFinite));

  host.innerHTML = `
    <h1 class="pageTitle">Settings</h1>

    <div class="grid2">
      <div class="card">
        <div class="cardTitle">Appearance</div>
        <div class="row" style="margin-top:10px">
          <div style="flex:1">
            <div class="smallMeta">Theme</div>
            <select id="setTheme">${THEMES.map(t => `<option value="${escapeHtml(t)}" ${t === theme ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select>
          </div>
          <div style="flex:1">
            <div class="smallMeta">Font size</div>
            <input id="setSize" class="input" type="number" min="10" max="22" value="${escapeHtml(size)}">
          </div>
        </div>
        <div style="margin-top:10px">
          <div class="smallMeta">Font family</div>
          <input id="setFont" class="input" list="fontList" value="${escapeHtml(font)}">
          <datalist id="fontList">${FONT_SUGGESTIONS.map(f => `<option value="${escapeHtml(f)}"></option>`).join("")}</datalist>
        </div>
      </div>

      <div class="card">
        <div class="cardTitle">Planner</div>
        <div style="margin-top:10px">
          <div class="smallMeta">Global revision days</div>
          <input id="setDays" class="input" value="${escapeHtml(globalDays)}">
        </div>
        <div style="margin-top:10px">
          <div class="smallMeta">Calendar indicators</div>
          <select id="setIndicators">
            <option value="dots" ${indicatorMode === "dots" ? "selected" : ""}>Dots</option>
            <option value="labels" ${indicatorMode === "labels" ? "selected" : ""}>Labels</option>
            <option value="both" ${indicatorMode === "both" ? "selected" : ""}>Both</option>
          </select>
        </div>
        <div style="margin-top:10px">
          <div class="smallMeta">Carry-forward daily cap</div>
          <input id="setCarryCap" class="input" type="number" min="20" max="30" value="${carryCap}">
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardTitle">Holidays</div>

      <div class="sectionTitle">Weekly off days</div>
      <div class="row" style="flex-wrap:wrap;gap:14px">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d,i) => `
          <label class="row" style="gap:8px;font-weight:900">
            <input type="checkbox" class="wkOff" data-i="${i}" ${weeklySet.has(i) ? "checked" : ""}>
            ${d}
          </label>
        `).join("")}
      </div>

      <div class="sectionTitle">Specific holidays</div>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <input id="holDate" class="input" data-date="1" style="max-width:200px" placeholder="YYYY-MM-DD">
        <input id="holDesc" class="input" style="max-width:340px" placeholder="Description">
        <button class="btn btnPrimary" id="holAdd">Add</button>
      </div>
      <div class="list" id="holList" style="margin-top:12px"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="cardTitle">Backup Center</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btnPrimary" id="expJson">Export JSON</button>
        <button class="btn btnPrimary" id="expCsv">Export CSV</button>
        <button class="btn btnPrimary" id="expXlsx">Export XLSX</button>
        <button class="btn btnPrimary" id="expPdf">Export PDF</button>
        <button class="btn" id="impJson">Import JSON</button>
        <input type="file" id="impFile" accept=".json,application/json" style="display:none">
      </div>
    </div>
  `;

  enhanceSelects(host);
  enhanceDateInputs(host);

  const saveAppearance = debounce(async () => {
    await db.setSetting("theme", $("#setTheme").value);
    await db.setSetting("font_family", $("#setFont").value.trim() || "Inter");
    await db.setSetting("font_size", String(parseInt($("#setSize").value, 10) || 13));
    await loadAppearance();
    toast("Saved.");
  }, 220);

  $("#setTheme").addEventListener("change", saveAppearance);
  $("#setFont").addEventListener("input", saveAppearance);
  $("#setSize").addEventListener("input", saveAppearance);

  const savePlanner = debounce(async () => {
    const days = parseDaysCSV($("#setDays").value);
    if (days.length) await db.setSetting("global_revision_days", days.join(","));
    await db.setSetting("calendar_indicator_mode", $("#setIndicators").value);
    const cap = Math.max(20, Math.min(30, parseInt($("#setCarryCap").value, 10) || 25));
    $("#setCarryCap").value = String(cap);
    await db.setSetting("carry_forward_cap", String(cap));
    toast("Saved.");
  }, 300);

  $("#setDays").addEventListener("input", savePlanner);
  $("#setIndicators").addEventListener("change", savePlanner);
  $("#setCarryCap").addEventListener("input", savePlanner);

  $$(".wkOff", host).forEach(cb => cb.addEventListener("change", async () => {
    const set = new Set(((await db.getSetting("weekly_holidays")) || "").split(",").map(x => parseInt(x, 10)).filter(Number.isFinite));
    const i = parseInt(cb.dataset.i, 10);
    if (cb.checked) set.add(i); else set.delete(i);
    await db.setSetting("weekly_holidays", [...set].sort((a,b) => a - b).join(","));
    toast("Saved.");
  }));

  async function renderHolidays() {
    const hols = await db.listHolidays();
    const list = $("#holList");
    list.innerHTML = "";

    if (!hols.length) {
      list.appendChild(el(`<div class="smallMeta">No holidays.</div>`));
      return;
    }

    hols.forEach(h => {
      list.appendChild(el(`
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
    });

    $$("[data-hdel]", list).forEach(b => b.addEventListener("click", async () => {
      const ok = await confirmModal({ title:"Remove holiday", message:"Remove this holiday?", confirmText:"Remove", danger:true });
      if (!ok) return;
      await db.deleteHoliday(parseInt(b.dataset.hdel, 10));
      renderHolidays();
    }));
  }
  renderHolidays();

  $("#holAdd").addEventListener("click", async () => {
    const date = $("#holDate").value;
    if (!date) return toast("Choose date.", "error");
    try {
      await db.addHoliday({ date, description: $("#holDesc").value.trim() });
      $("#holDate").value = "";
      $("#holDesc").value = "";
      toast("Added.");
      renderHolidays();
    } catch {
      toast("Already exists.", "error");
    }
  });

  $("#expJson").addEventListener("click", exportJSON);
  $("#expCsv").addEventListener("click", exportCSV);
  $("#expXlsx").addEventListener("click", exportXLSX);
  $("#expPdf").addEventListener("click", exportPDF);

  $("#impJson").addEventListener("click", () => $("#impFile").click());
  $("#impFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const mode = await importModeModal();
      if (!mode) return;
      if (mode === "replace") await db.replaceAll(data);
      else await db.mergeAll(data);

      await db.ensureDefaults({
        theme: "Apple Light",
        font_family: "Inter",
        font_size: "13",
        global_revision_days: "3,7,14,28",
        weekly_holidays: "",
        last_opened: "",
        calendar_indicator_mode: "both",
        carry_forward_cap: "25"
      });

      await loadAppearance();
      toast("Imported.");
      setPage("today");
    } catch {
      toast("Import failed.", "error");
    } finally {
      e.target.value = "";
    }
  });
}

/* ---------------- Modals ---------------- */
async function openSubjectModal(existing=null) {
  const isEdit = !!existing;
  const selected = existing?.color || SUBJECT_SWATCHES[0];

  showModal({
    title: isEdit ? "Edit Subject" : "Add Subject",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="smallMeta">Name</label>
      <input class="input" name="name" value="${escapeHtml(existing?.name || "")}" required>

      <label class="smallMeta">Color</label>
      <div class="row">
        <div class="colorPreview" data-color-preview style="background:${selected}"></div>
        <input type="color" name="customColor" value="${selected}" style="width:48px;height:44px;border:none;background:transparent">
      </div>
      <div class="colorSwatches" style="margin-top:10px">
        ${SUBJECT_SWATCHES.map(c => `<button type="button" class="colorSwatch ${c === selected ? "isSelected" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}
      </div>
      <input type="hidden" name="color" value="${selected}">

      <label class="row" style="gap:8px;font-weight:900;margin-top:8px">
        <input type="checkbox" name="useCustom" ${existing?.revisionDays?.length ? "checked" : ""}>
        Custom revision days
      </label>
      <input class="input" name="customDays" value="${escapeHtml(existing?.revisionDays?.join(",") || "")}" placeholder="1,3,7,14,28">
    `,
    onSubmit: async (fd) => {
      const name = fd.get("name").trim();
      if (!name) {
        toast("Enter subject name.", "error");
        return false;
      }

      const color = fd.get("color");
      const revisionDays = fd.get("useCustom") === "on" ? parseDaysCSV(fd.get("customDays")) : null;

      try {
        if (isEdit) {
          existing.name = name;
          existing.color = color;
          existing.revisionDays = revisionDays?.length ? revisionDays : null;
          await db.updateSubject(existing);
        } else {
          await db.addSubject({ name, color, revisionDays: revisionDays?.length ? revisionDays : null });
        }
      } catch {
        toast("Name already exists.", "error");
        return false;
      }

      toast("Saved.");
      await renderSubjects();
      return true;
    }
  });
}

async function openTopicModal(existing=null) {
  const isEdit = !!existing;
  const subjects = await db.listSubjects();
  if (!subjects.length) {
    toast("Add subject first.", "error");
    return;
  }

  showModal({
    title: isEdit ? "Edit Topic" : "Add Topic",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="smallMeta">Subject</label>
      <select name="subjectId">
        ${subjects.map(s => `<option value="${s.id}" ${existing?.subjectId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="smallMeta">Topic</label>
      <input class="input" name="name" value="${escapeHtml(existing?.name || "")}" required>

      ${isEdit ? "" : `
        <label class="smallMeta">Date</label>
        <input class="input" name="dateAdded" data-date="1" value="${isoToday()}" placeholder="YYYY-MM-DD" required>
      `}

      <label class="smallMeta">Notes</label>
      <textarea name="notesText">${escapeHtml(existing?.notesText || "")}</textarea>

      <label class="smallMeta">Checklist</label>
      <textarea name="notesChecklist" placeholder="One item per line">${escapeHtml(checklistToText(existing?.notesChecklist || []))}</textarea>
    `,
    onSubmit: async (fd) => {
      const subjectId = parseInt(fd.get("subjectId"), 10);
      const name = fd.get("name").trim();

      if (!name) {
        toast("Enter topic name.", "error");
        return false;
      }

      if (isEdit) {
        existing.subjectId = subjectId;
        existing.name = name;
        existing.notesText = fd.get("notesText").trim();
        existing.notesChecklist = parseChecklistText(fd.get("notesChecklist"));
        await db.updateTopic(existing);
      } else {
        const dateAdded = fd.get("dateAdded") || isoToday();

        const topicId = await db.addTopic({
          subjectId,
          name,
          dateAdded,
          notesText: fd.get("notesText").trim(),
          notesChecklist: parseChecklistText(fd.get("notesChecklist")),
          archived: false
        });

        const subject = await db.getSubject(subjectId);
        const intervals = subject?.revisionDays?.length
          ? subject.revisionDays
          : parseDaysCSV((await db.getSetting("global_revision_days")) || "3,7,14,28");

        const holidaySet = new Set((await db.listHolidays()).map(h => h.date));
        const weeklyOffSet = new Set(
          ((await db.getSetting("weekly_holidays")) || "")
            .split(",")
            .map(x => parseInt(x, 10))
            .filter(Number.isFinite)
        );

        const revs = scheduleRevisions({
          topicId,
          dateAddedISO: dateAdded,
          dayIntervals: intervals,
          holidaySet,
          weeklyOffSet
        });

        await db.addRevisions(revs);
      }

      toast("Saved.");
      await render(currentPageName());
      return true;
    }
  });
}

async function openHomeworkModal(existing=null) {
  const isEdit = !!existing;
  const subjects = await db.listSubjects();
  if (!subjects.length) {
    toast("Add subject first.", "error");
    return;
  }

  showModal({
    title: isEdit ? "Edit Homework" : "Add Homework",
    submitText: isEdit ? "Save" : "Add",
    body: `
      <label class="smallMeta">Subject</label>
      <select name="subjectId">
        ${subjects.map(s => `<option value="${s.id}" ${existing?.subjectId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="smallMeta">Title</label>
      <input class="input" name="title" value="${escapeHtml(existing?.title || "")}" required>

      <label class="smallMeta">Description</label>
      <textarea name="description">${escapeHtml(existing?.description || "")}</textarea>

      <div class="grid2">
        <div>
          <label class="smallMeta">Due date</label>
          <input class="input" name="dueDate" data-date="1" value="${escapeHtml(existing?.dueDate || addDays(isoToday(), 1))}" placeholder="YYYY-MM-DD" required>
        </div>
        <div>
          <label class="smallMeta">Priority</label>
          <select name="priority">
            ${["high","medium","low"].map(p => `<option value="${p}" ${(existing?.priority || "medium") === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </div>
      </div>

      <label class="smallMeta">Checklist</label>
      <textarea name="notesChecklist" placeholder="One item per line">${escapeHtml(checklistToText(existing?.notesChecklist || []))}</textarea>
    `,
    onSubmit: async (fd) => {
      const row = {
        ...(existing || {}),
        subjectId: parseInt(fd.get("subjectId"), 10),
        title: fd.get("title").trim(),
        description: fd.get("description").trim(),
        dueDate: fd.get("dueDate"),
        priority: fd.get("priority"),
        notesChecklist: parseChecklistText(fd.get("notesChecklist")),
        status: existing?.status || "pending",
        archived: existing?.archived || false,
        dateAdded: existing?.dateAdded || isoToday()
      };

      if (!row.title) {
        toast("Enter homework title.", "error");
        return false;
      }

      if (isEdit) {
        await db.updateHomework(row);
      } else {
        await db.addHomework(row);
      }

      toast("Saved.");
      await render(currentPageName());
      return true;
    }
  });
}

async function openExamModal(existing=null, defaultDate=null) {
  const isEdit = !!existing;
  const subjects = await db.listSubjects();
  const topics = visibleOnly(await db.listTopics());
  const linked = new Set(existing?.linkedTopicIds || []);

  if (!subjects.length) {
    toast("Add subject first.", "error");
    return;
  }

  const subjectNames = new Map(subjects.map(s => [s.id, s.name]));

  showModal({
    title: isEdit ? "Edit Exam" : "Add Exam",
    submitText: isEdit ? "Save" : "Add",
    wide: true,
    body: `
      <label class="smallMeta">Subject</label>
      <select name="subjectId">
        ${subjects.map(s => `<option value="${s.id}" ${existing?.subjectId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>

      <label class="smallMeta">Title</label>
      <input class="input" name="title" value="${escapeHtml(existing?.title || "")}" required>

      <div class="grid2">
        <div>
          <label class="smallMeta">Exam date</label>
          <input class="input" name="examDate" data-date="1" value="${escapeHtml(existing?.examDate || defaultDate || isoToday())}" placeholder="YYYY-MM-DD" required>
        </div>
        <div>
          <label class="smallMeta">Time</label>
          <input class="input" name="examTime" value="${escapeHtml(existing?.examTime || "")}" placeholder="HH:MM">
        </div>
      </div>

      <div class="grid2">
        <div>
          <label class="smallMeta">Priority</label>
          <select name="priority">
            ${["high","medium","low"].map(p => `<option value="${p}" ${(existing?.priority || "medium") === p ? "selected" : ""}>${p}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="smallMeta">Status</label>
          <select name="status">
            <option value="scheduled" ${(existing?.status || "scheduled") === "scheduled" ? "selected" : ""}>Scheduled</option>
            <option value="completed" ${(existing?.status || "scheduled") === "completed" ? "selected" : ""}>Completed</option>
          </select>
        </div>
      </div>

      <div class="grid2">
        <div>
          <label class="smallMeta">Syllabus coverage %</label>
          <input class="input" name="syllabusCoverage" type="number" min="0" max="100" value="${escapeHtml(existing?.syllabusCoverage || 0)}">
        </div>
        <div>
          <label class="smallMeta">Target study hours</label>
          <input class="input" name="targetHours" type="number" min="0" step="0.5" value="${escapeHtml(existing?.targetHours || 0)}">
        </div>
      </div>

      <label class="smallMeta">Linked topics</label>
      <div class="linkedTopicsBox">
        ${topics.length
          ? topics.map(tp => `
            <label class="row" style="gap:8px; margin-bottom:8px; font-weight:800">
              <input type="checkbox" name="linkedTopicIds" value="${tp.id}" ${linked.has(tp.id) ? "checked" : ""}>
              ${escapeHtml(tp.name)} <span class="smallMeta">(${escapeHtml(subjectNames.get(tp.subjectId) || "Subject")})</span>
            </label>
          `).join("")
          : `<div class="smallMeta">No topics.</div>`
        }
      </div>

      <label class="smallMeta">Notes</label>
      <textarea name="notesText">${escapeHtml(existing?.notesText || "")}</textarea>

      <label class="smallMeta">Checklist</label>
      <textarea name="notesChecklist" placeholder="One item per line">${escapeHtml(checklistToText(existing?.notesChecklist || []))}</textarea>
    `,
    onSubmit: async (fd) => {
      const row = {
        ...(existing || {}),
        subjectId: parseInt(fd.get("subjectId"), 10),
        title: fd.get("title").trim(),
        examDate: fd.get("examDate"),
        examTime: fd.get("examTime").trim(),
        priority: fd.get("priority"),
        status: fd.get("status"),
        syllabusCoverage: Math.max(0, Math.min(100, parseInt(fd.get("syllabusCoverage"), 10) || 0)),
        targetHours: Math.max(0, parseFloat(fd.get("targetHours")) || 0),
        linkedTopicIds: fd.getAll("linkedTopicIds").map(x => parseInt(x, 10)).filter(Number.isFinite),
        notesText: fd.get("notesText").trim(),
        notesChecklist: parseChecklistText(fd.get("notesChecklist")),
        archived: existing?.archived || false,
        dateAdded: existing?.dateAdded || isoToday()
      };

      if (!row.title || !row.examDate) {
        toast("Enter exam title and date.", "error");
        return false;
      }

      if (row.status === "completed") row.archived = true;
      else row.archived = false;

      if (isEdit) {
        await db.updateExam(row);
      } else {
        await db.addExam(row);
      }

      toast("Saved.");
      await render(currentPageName());
      return true;
    }
  });
}

/* ---------------- Export ---------------- */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportJSON() {
  const data = await db.exportAll();
  downloadBlob("studyloop_backup.json", new Blob([JSON.stringify(data, null, 2)], { type:"application/json" }));
  toast("Exported.");
}

async function exportCSV() {
  const subs = await subjectsMap();
  const tMap = await topicsMap();
  const revisions = await db.revisionsInRange("0000-01-01", "9999-12-31");

  const rows = [["Topic","Subject","Date Added","Revision #","Interval Day","Scheduled Date","Status"]];
  revisions.forEach(r => {
    const tp = tMap.get(r.topicId);
    const s = tp ? subs.get(tp.subjectId) : null;
    rows.push([tp?.name || "", s?.name || "", tp?.dateAdded || "", r.revisionNum, r.dayInterval, r.scheduledDate, r.status]);
  });

  const csv = rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  downloadBlob("studyloop_data.csv", new Blob([csv], { type:"text/csv" }));
  toast("Exported.");
}

async function exportXLSX() {
  if (!window.XLSX) {
    toast("XLSX not loaded.", "error");
    return;
  }

  const data = await db.exportAll();
  const subs = new Map(data.subjects.map(s => [s.id, s.name]));
  const topics = new Map(data.topics.map(t => [t.id, t]));

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.revisions.map(r => ({
    Topic: topics.get(r.topicId)?.name || "",
    Subject: subs.get(topics.get(r.topicId)?.subjectId) || "",
    Revision: r.revisionNum,
    Day: r.dayInterval,
    Scheduled: r.scheduledDate,
    Status: r.status
  }))), "Revisions");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.homework.map(h => ({
    Title: h.title,
    Subject: subs.get(h.subjectId) || "",
    Due: h.dueDate,
    Priority: h.priority,
    Status: h.status
  }))), "Homework");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.exams.map(e => ({
    Title: e.title,
    Subject: subs.get(e.subjectId) || "",
    Date: e.examDate,
    Time: e.examTime || "",
    Priority: e.priority || "",
    Status: e.status || ""
  }))), "Exams");

  const out = XLSX.write(wb, { bookType:"xlsx", type:"array" });
  downloadBlob("studyloop_data.xlsx", new Blob([out], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  toast("Exported.");
}

async function exportPDF() {
  const jspdf = window.jspdf;
  if (!jspdf) {
    toast("PDF not loaded.", "error");
    return;
  }

  const { jsPDF } = jspdf;
  const doc = new jsPDF({ unit:"pt", format:"a4" });
  const data = await db.exportAll();

  doc.setFont("helvetica","bold");
  doc.setFontSize(18);
  doc.text("StudyLoop Report", 40, 55);

  doc.setFont("helvetica","normal");
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 75);

  let y = 110;
  const line = (text, bold=false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(text, 40, y);
    y += 18;
  };

  line("Summary", true);
  line(`Subjects: ${data.subjects.length}`);
  line(`Topics: ${data.topics.length}`);
  line(`Revisions: ${data.revisions.length}`);
  line(`Homework: ${data.homework.length}`);
  line(`Exams: ${data.exams.length}`);

  doc.save("studyloop_report.pdf");
  toast("Exported.");
}

/* ---------------- Start ---------------- */
async function start() {
  db = await StudyLoopDB.open();

  await db.ensureDefaults({
    theme: "Apple Light",
    font_family: "Inter",
    font_size: "13",
    global_revision_days: "3,7,14,28",
    weekly_holidays: "",
    last_opened: "",
    calendar_indicator_mode: "both",
    carry_forward_cap: "25"
  });

  await loadAppearance();
  await registerSW();
  await checkCarryForward();

  setPage("today");
}

start();
