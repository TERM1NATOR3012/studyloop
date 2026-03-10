const DB_NAME = "studyloop";
const DB_VERSION = 2; // <-- bumped to 2 (IMPORTANT)

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error("Transaction error"));
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  });
}

function ensureStore(db, name, opts) {
  if (!db.objectStoreNames.contains(name)) {
    return db.createObjectStore(name, opts);
  }
  return null;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const old = event.oldVersion || 0;

      // v1 schema (create if missing)
      if (old < 1) {
        const subjects = ensureStore(db, "subjects", { keyPath: "id", autoIncrement: true });
        subjects?.createIndex("name", "name", { unique: true });

        const topics = ensureStore(db, "topics", { keyPath: "id", autoIncrement: true });
        topics?.createIndex("subjectId", "subjectId", { unique: false });
        topics?.createIndex("dateAdded", "dateAdded", { unique: false });

        const revisions = ensureStore(db, "revisions", { keyPath: "id", autoIncrement: true });
        revisions?.createIndex("topicId", "topicId", { unique: false });
        revisions?.createIndex("scheduledDate", "scheduledDate", { unique: false });
        revisions?.createIndex("status", "status", { unique: false });

        const homework = ensureStore(db, "homework", { keyPath: "id", autoIncrement: true });
        homework?.createIndex("subjectId", "subjectId", { unique: false });
        homework?.createIndex("dueDate", "dueDate", { unique: false });
        homework?.createIndex("status", "status", { unique: false });

        const holidays = ensureStore(db, "holidays", { keyPath: "id", autoIncrement: true });
        holidays?.createIndex("date", "date", { unique: true });

        ensureStore(db, "settings", { keyPath: "key" });
        ensureStore(db, "dailyLog", { keyPath: "date" });
      }

      // v2: exams
      if (old < 2) {
        const exams = ensureStore(db, "exams", { keyPath: "id", autoIncrement: true });
        exams?.createIndex("subjectId", "subjectId", { unique: false });
        exams?.createIndex("examDate", "examDate", { unique: false });
        exams?.createIndex("status", "status", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeNames, mode = "readonly") {
  const t = db.transaction(storeNames, mode);
  const stores = {};
  for (const n of storeNames) stores[n] = t.objectStore(n);
  return { t, stores };
}

export class StudyLoopDB {
  static async open() {
    const db = await openDB();
    return new StudyLoopDB(db);
  }

  constructor(db) { this.db = db; }

  async getSetting(key) {
    const { stores } = tx(this.db, ["settings"]);
    const v = await promisifyRequest(stores.settings.get(key));
    return v ? v.value : null;
  }

  async setSetting(key, value) {
    const { t, stores } = tx(this.db, ["settings"], "readwrite");
    stores.settings.put({ key, value: String(value) });
    await txDone(t);
  }

  async ensureDefaults(defaults) {
    for (const [k, v] of Object.entries(defaults)) {
      const cur = await this.getSetting(k);
      if (cur === null || cur === undefined || cur === "") await this.setSetting(k, v);
    }
  }

  // Subjects
  async listSubjects() {
    const { stores } = tx(this.db, ["subjects"]);
    const all = await promisifyRequest(stores.subjects.getAll());
    all.sort((a,b) => a.name.localeCompare(b.name));
    return all;
  }
  async addSubject(subject) {
    const { stores } = tx(this.db, ["subjects"], "readwrite");
    return promisifyRequest(stores.subjects.add(subject));
  }
  async updateSubject(subject) {
    const { stores } = tx(this.db, ["subjects"], "readwrite");
    return promisifyRequest(stores.subjects.put(subject));
  }
  async getSubject(id) {
    const { stores } = tx(this.db, ["subjects"]);
    return promisifyRequest(stores.subjects.get(id));
  }

  async deleteSubject(subjectId) {
    const topics = await this.listTopics({ subjectId });
    for (const tp of topics) await this.deleteTopic(tp.id);

    const hws = await this.listHomework({ subjectId });
    for (const h of hws) await this.deleteHomework(h.id);

    const exs = await this.listExams({ subjectId });
    for (const e of exs) await this.deleteExam(e.id);

    const { stores } = tx(this.db, ["subjects"], "readwrite");
    return promisifyRequest(stores.subjects.delete(subjectId));
  }

  // Topics
  async listTopics({ subjectId=null, search=null } = {}) {
    const { stores } = tx(this.db, ["topics"]);
    const all = await promisifyRequest(stores.topics.getAll());
    let out = all;
    if (subjectId !== null) out = out.filter(t => t.subjectId === subjectId);
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(t => (t.name||"").toLowerCase().includes(s));
    }
    out.sort((a,b) => (b.dateAdded||"").localeCompare(a.dateAdded||""));
    return out;
  }
  async addTopic(topic) {
    const { stores } = tx(this.db, ["topics"], "readwrite");
    return promisifyRequest(stores.topics.add(topic));
  }
  async updateTopic(topic) {
    const { stores } = tx(this.db, ["topics"], "readwrite");
    return promisifyRequest(stores.topics.put(topic));
  }
  async getTopic(id) {
    const { stores } = tx(this.db, ["topics"]);
    return promisifyRequest(stores.topics.get(id));
  }
  async deleteTopic(topicId) {
    const revs = await this.listRevisionsByTopic(topicId);
    const { t, stores } = tx(this.db, ["revisions","topics"], "readwrite");
    for (const r of revs) stores.revisions.delete(r.id);
    stores.topics.delete(topicId);
    await txDone(t);
  }

  // Revisions
  async addRevisions(revisions) {
    const { t, stores } = tx(this.db, ["revisions"], "readwrite");
    for (const r of revisions) stores.revisions.add(r);
    await txDone(t);
  }
  async listRevisionsByDate(dateStr) {
    const { stores } = tx(this.db, ["revisions"]);
    return promisifyRequest(stores.revisions.index("scheduledDate").getAll(dateStr));
  }
  async listPendingRevisionsByDate(dateStr) {
    const all = await this.listRevisionsByDate(dateStr);
    return all.filter(r => r.status === "pending");
  }
  async listRevisionsByTopic(topicId) {
    const { stores } = tx(this.db, ["revisions"]);
    const all = await promisifyRequest(stores.revisions.index("topicId").getAll(topicId));
    all.sort((a,b) => a.revisionNum - b.revisionNum);
    return all;
  }
  async getRevision(id) {
    const { stores } = tx(this.db, ["revisions"]);
    return promisifyRequest(stores.revisions.get(id));
  }
  async updateRevision(rev) {
    const { stores } = tx(this.db, ["revisions"], "readwrite");
    return promisifyRequest(stores.revisions.put(rev));
  }
  async pendingRevisionsInRange(fromDate, toDate) {
    const { stores } = tx(this.db, ["revisions"]);
    const range = IDBKeyRange.bound(fromDate, toDate);
    const all = await promisifyRequest(stores.revisions.index("scheduledDate").getAll(range));
    return all.filter(r => r.status === "pending");
  }
  async revisionsInRange(fromDate, toDate) {
    const { stores } = tx(this.db, ["revisions"]);
    const range = IDBKeyRange.bound(fromDate, toDate);
    return promisifyRequest(stores.revisions.index("scheduledDate").getAll(range));
  }

  // Homework
  async listHomework({ subjectId=null, status=null } = {}) {
    const { stores } = tx(this.db, ["homework"]);
    const all = await promisifyRequest(stores.homework.getAll());
    let out = all;
    if (subjectId !== null) out = out.filter(h => h.subjectId === subjectId);
    if (status) out = out.filter(h => h.status === status);
    out.sort((a,b) => (a.dueDate||"").localeCompare(b.dueDate||""));
    return out;
  }
  async listHomeworkByDate(dateStr) {
    const { stores } = tx(this.db, ["homework"]);
    return promisifyRequest(stores.homework.index("dueDate").getAll(dateStr));
  }
  async addHomework(hw) {
    const { stores } = tx(this.db, ["homework"], "readwrite");
    return promisifyRequest(stores.homework.add(hw));
  }
  async updateHomework(hw) {
    const { stores } = tx(this.db, ["homework"], "readwrite");
    return promisifyRequest(stores.homework.put(hw));
  }
  async getHomework(id) {
    const { stores } = tx(this.db, ["homework"]);
    return promisifyRequest(stores.homework.get(id));
  }
  async deleteHomework(id) {
    const { stores } = tx(this.db, ["homework"], "readwrite");
    return promisifyRequest(stores.homework.delete(id));
  }

  // Holidays
  async listHolidays() {
    const { stores } = tx(this.db, ["holidays"]);
    const all = await promisifyRequest(stores.holidays.getAll());
    all.sort((a,b) => (a.date||"").localeCompare(b.date||""));
    return all;
  }
  async addHoliday(h) {
    const { stores } = tx(this.db, ["holidays"], "readwrite");
    return promisifyRequest(stores.holidays.add(h));
  }
  async deleteHoliday(id) {
    const { stores } = tx(this.db, ["holidays"], "readwrite");
    return promisifyRequest(stores.holidays.delete(id));
  }

  // Exams (NEW)
  async listExams({ subjectId=null, status=null } = {}) {
    const { stores } = tx(this.db, ["exams"]);
    const all = await promisifyRequest(stores.exams.getAll());
    let out = all;
    if (subjectId !== null) out = out.filter(e => e.subjectId === subjectId);
    if (status) out = out.filter(e => e.status === status);
    out.sort((a,b) => (a.examDate||"").localeCompare(b.examDate||""));
    return out;
  }

  async listExamsByDate(dateStr) {
    const { stores } = tx(this.db, ["exams"]);
    return promisifyRequest(stores.exams.index("examDate").getAll(dateStr));
  }

  async addExam(exam) {
    const { stores } = tx(this.db, ["exams"], "readwrite");
    return promisifyRequest(stores.exams.add(exam));
  }

  async updateExam(exam) {
    const { stores } = tx(this.db, ["exams"], "readwrite");
    return promisifyRequest(stores.exams.put(exam));
  }

  async getExam(id) {
    const { stores } = tx(this.db, ["exams"]);
    return promisifyRequest(stores.exams.get(id));
  }

  async deleteExam(id) {
    const { stores } = tx(this.db, ["exams"], "readwrite");
    return promisifyRequest(stores.exams.delete(id));
  }

  // Daily log
  async logDay(dateStr, allCompleted) {
    const { stores } = tx(this.db, ["dailyLog"], "readwrite");
    return promisifyRequest(stores.dailyLog.put({ date: dateStr, allCompleted: allCompleted ? 1 : 0 }));
  }
  async getDailyLog(dateStr) {
    const { stores } = tx(this.db, ["dailyLog"]);
    return promisifyRequest(stores.dailyLog.get(dateStr));
  }
}
