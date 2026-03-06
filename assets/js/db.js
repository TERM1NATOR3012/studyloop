const DB_NAME = "studyloop";
const DB_VERSION = 1;

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      const subjects = db.createObjectStore("subjects", { keyPath: "id", autoIncrement: true });
      subjects.createIndex("name", "name", { unique: true });

      const topics = db.createObjectStore("topics", { keyPath: "id", autoIncrement: true });
      topics.createIndex("subjectId", "subjectId", { unique: false });
      topics.createIndex("dateAdded", "dateAdded", { unique: false });

      const revisions = db.createObjectStore("revisions", { keyPath: "id", autoIncrement: true });
      revisions.createIndex("topicId", "topicId", { unique: false });
      revisions.createIndex("scheduledDate", "scheduledDate", { unique: false });
      revisions.createIndex("status", "status", { unique: false });

      const homework = db.createObjectStore("homework", { keyPath: "id", autoIncrement: true });
      homework.createIndex("subjectId", "subjectId", { unique: false });
      homework.createIndex("dueDate", "dueDate", { unique: false });
      homework.createIndex("status", "status", { unique: false });

      const holidays = db.createObjectStore("holidays", { keyPath: "id", autoIncrement: true });
      holidays.createIndex("date", "date", { unique: true });

      db.createObjectStore("settings", { keyPath: "key" });
      db.createObjectStore("dailyLog", { keyPath: "date" });
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
    return promisifyRequest(t.done ?? new Promise((res, rej) => { t.oncomplete=res; t.onerror=rej; }));
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

  async deleteSubject(subjectId) {
    // cascade delete: topics + revisions + homework
    const topics = await this.listTopics({ subjectId });
    for (const tp of topics) await this.deleteTopic(tp.id);

    const hws = await this.listHomework({ subjectId });
    for (const h of hws) await this.deleteHomework(h.id);

    const { stores } = tx(this.db, ["subjects"], "readwrite");
    return promisifyRequest(stores.subjects.delete(subjectId));
  }

  async getSubject(id) {
    const { stores } = tx(this.db, ["subjects"]);
    return promisifyRequest(stores.subjects.get(id));
  }

  // Topics
  async listTopics({ subjectId=null, search=null } = {}) {
    const { stores } = tx(this.db, ["topics"]);
    const all = await promisifyRequest(stores.topics.getAll());
    let out = all;
    if (subjectId !== null) out = out.filter(t => t.subjectId === subjectId);
    if (search) {
      const s = search.toLowerCase();
      out = out.filter(t => (t.name || "").toLowerCase().includes(s));
    }
    out.sort((a,b) => (b.dateAdded || "").localeCompare(a.dateAdded || ""));
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
    // delete revisions for topic
    const revs = await this.listRevisionsByTopic(topicId);
    const { stores } = tx(this.db, ["revisions", "topics"], "readwrite");
    for (const r of revs) stores.revisions.delete(r.id);
    stores.topics.delete(topicId);
    return promisifyRequest(stores.topics.transaction.done ?? new Promise((res, rej) => {
      stores.topics.transaction.oncomplete=res; stores.topics.transaction.onerror=rej;
    }));
  }

  // Revisions
  async addRevisions(revisions) {
    const { stores } = tx(this.db, ["revisions"], "readwrite");
    for (const r of revisions) stores.revisions.add(r);
    return promisifyRequest(stores.revisions.transaction.done ?? new Promise((res, rej) => {
      stores.revisions.transaction.oncomplete=res; stores.revisions.transaction.onerror=rej;
    }));
  }

  async listRevisionsByDate(dateStr) {
    const { stores } = tx(this.db, ["revisions"]);
    const idx = stores.revisions.index("scheduledDate");
    const all = await promisifyRequest(idx.getAll(dateStr));
    return all;
  }

  async listPendingRevisionsByDate(dateStr) {
    const all = await this.listRevisionsByDate(dateStr);
    return all.filter(r => r.status === "pending");
  }

  async listRevisionsByTopic(topicId) {
    const { stores } = tx(this.db, ["revisions"]);
    const idx = stores.revisions.index("topicId");
    const all = await promisifyRequest(idx.getAll(topicId));
    all.sort((a,b) => a.revisionNum - b.revisionNum);
    return all;
  }

  async updateRevision(rev) {
    const { stores } = tx(this.db, ["revisions"], "readwrite");
    return promisifyRequest(stores.revisions.put(rev));
  }

  async getRevision(id) {
    const { stores } = tx(this.db, ["revisions"]);
    return promisifyRequest(stores.revisions.get(id));
  }

  async pendingRevisionsInRange(fromDate, toDate) {
    const { stores } = tx(this.db, ["revisions"]);
    const idx = stores.revisions.index("scheduledDate");
    const range = IDBKeyRange.bound(fromDate, toDate);
    const all = await promisifyRequest(idx.getAll(range));
    return all.filter(r => r.status === "pending");
  }

  async revisionsInRange(fromDate, toDate) {
    const { stores } = tx(this.db, ["revisions"]);
    const idx = stores.revisions.index("scheduledDate");
    const range = IDBKeyRange.bound(fromDate, toDate);
    return promisifyRequest(idx.getAll(range));
  }

  // Homework
  async listHomework({ subjectId=null, status=null } = {}) {
    const { stores } = tx(this.db, ["homework"]);
    const all = await promisifyRequest(stores.homework.getAll());
    let out = all;
    if (subjectId !== null) out = out.filter(h => h.subjectId === subjectId);
    if (status) out = out.filter(h => h.status === status);
    out.sort((a,b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
    return out;
  }

  async listHomeworkByDate(dateStr) {
    const { stores } = tx(this.db, ["homework"]);
    const idx = stores.homework.index("dueDate");
    return promisifyRequest(idx.getAll(dateStr));
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

  // Daily log / streak
  async logDay(dateStr, allCompleted) {
    const { stores } = tx(this.db, ["dailyLog"], "readwrite");
    return promisifyRequest(stores.dailyLog.put({ date: dateStr, allCompleted: allCompleted ? 1 : 0 }));
  }

  async getDailyLog(dateStr) {
    const { stores } = tx(this.db, ["dailyLog"]);
    return promisifyRequest(stores.dailyLog.get(dateStr));
  }
}