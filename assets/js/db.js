const DB_NAME = "studyloop";
const DB_VERSION = 3;

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

function ensureStore(db, name, options) {
  if (!db.objectStoreNames.contains(name)) return db.createObjectStore(name, options);
  return null;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const old = event.oldVersion || 0;

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

function stripId(obj) {
  const copy = { ...obj };
  delete copy.id;
  return copy;
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

  async getAllStore(name) {
    const { stores } = tx(this.db, [name]);
    return promisifyRequest(stores[name].getAll());
  }

  async clearStores(names) {
    const { t, stores } = tx(this.db, names, "readwrite");
    for (const n of names) stores[n].clear();
    await txDone(t);
  }

  async exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      subjects: await this.getAllStore("subjects"),
      topics: await this.getAllStore("topics"),
      revisions: await this.getAllStore("revisions"),
      homework: await this.getAllStore("homework"),
      exams: await this.getAllStore("exams"),
      holidays: await this.getAllStore("holidays"),
      settings: await this.getAllStore("settings"),
      dailyLog: await this.getAllStore("dailyLog")
    };
  }

  async replaceAll(data) {
    const names = ["subjects","topics","revisions","homework","exams","holidays","settings","dailyLog"];
    const { t, stores } = tx(this.db, names, "readwrite");

    for (const n of names) stores[n].clear();

    for (const row of data.subjects || []) stores.subjects.put(row);
    for (const row of data.topics || []) stores.topics.put(row);
    for (const row of data.revisions || []) stores.revisions.put(row);
    for (const row of data.homework || []) stores.homework.put(row);
    for (const row of data.exams || []) stores.exams.put(row);
    for (const row of data.holidays || []) stores.holidays.put(row);

    if (Array.isArray(data.settings)) {
      for (const row of data.settings) stores.settings.put(row);
    } else if (data.settings && typeof data.settings === "object") {
      for (const [key, value] of Object.entries(data.settings)) stores.settings.put({ key, value: String(value) });
    }

    for (const row of data.dailyLog || []) stores.dailyLog.put(row);
    await txDone(t);
  }

  async mergeAll(data) {
    const subjectMap = new Map();
    const existingSubjects = await this.listSubjects();

    for (const s of (data.subjects || [])) {
      const match = existingSubjects.find(x => x.name === s.name);
      if (match) {
        subjectMap.set(s.id, match.id);
      } else {
        const newId = await this.addSubject(stripId(s));
        subjectMap.set(s.id, newId);
        existingSubjects.push({ ...stripId(s), id: newId });
      }
    }

    const topicMap = new Map();
    const existingTopics = await this.listTopics();

    for (const tp of (data.topics || [])) {
      const mappedSubjectId = subjectMap.get(tp.subjectId) ?? tp.subjectId;
      const match = existingTopics.find(x =>
        x.subjectId === mappedSubjectId &&
        x.name === tp.name &&
        x.dateAdded === tp.dateAdded
      );

      if (match) {
        topicMap.set(tp.id, match.id);
      } else {
        const newId = await this.addTopic({ ...stripId(tp), subjectId: mappedSubjectId });
        topicMap.set(tp.id, newId);
        existingTopics.push({ ...stripId(tp), id: newId, subjectId: mappedSubjectId });
      }
    }

    for (const r of (data.revisions || [])) {
      const mappedTopicId = topicMap.get(r.topicId);
      if (!mappedTopicId) continue;
      const existingRevs = await this.listRevisionsByTopic(mappedTopicId);
      const dup = existingRevs.find(x =>
        x.revisionNum === r.revisionNum &&
        x.dayInterval === r.dayInterval &&
        x.originalDate === r.originalDate
      );
      if (!dup) {
        await this.addRevisions([{ ...stripId(r), topicId: mappedTopicId }]);
      }
    }

    const existingHW = await this.listHomework();
    for (const h of (data.homework || [])) {
      const mappedSubjectId = subjectMap.get(h.subjectId) ?? h.subjectId;
      const dup = existingHW.find(x =>
        x.subjectId === mappedSubjectId &&
        x.title === h.title &&
        x.dueDate === h.dueDate
      );
      if (!dup) {
        const newRow = { ...stripId(h), subjectId: mappedSubjectId };
        await this.addHomework(newRow);
        existingHW.push(newRow);
      }
    }

    const existingEx = await this.listExams();
    for (const e of (data.exams || [])) {
      const mappedSubjectId = subjectMap.get(e.subjectId) ?? e.subjectId;
      const dup = existingEx.find(x =>
        x.subjectId === mappedSubjectId &&
        x.title === e.title &&
        x.examDate === e.examDate
      );
      if (!dup) {
        const newRow = { ...stripId(e), subjectId: mappedSubjectId };
        await this.addExam(newRow);
        existingEx.push(newRow);
      }
    }

    const existingHol = await this.listHolidays();
    for (const h of (data.holidays || [])) {
      const dup = existingHol.find(x => x.date === h.date);
      if (!dup) {
        await this.addHoliday(stripId(h));
        existingHol.push(stripId(h));
      }
    }

    for (const log of (data.dailyLog || [])) {
      const cur = await this.getDailyLog(log.date);
      if (!cur || Number(log.allCompleted) > Number(cur.allCompleted)) {
        await this.logDay(log.date, !!log.allCompleted);
      }
    }
  }

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
    const revs = await this.listRevisionsByTopic(topicId);
    const { t, stores } = tx(this.db, ["revisions","topics"], "readwrite");
    for (const r of revs) stores.revisions.delete(r.id);
    stores.topics.delete(topicId);
    await txDone(t);
  }

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

  async listHolidays() {
    const { stores } = tx(this.db, ["holidays"]);
    const all = await promisifyRequest(stores.holidays.getAll());
    all.sort((a,b) => (a.date || "").localeCompare(b.date || ""));
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

  async listExams({ subjectId=null, status=null } = {}) {
    const { stores } = tx(this.db, ["exams"]);
    const all = await promisifyRequest(stores.exams.getAll());
    let out = all;
    if (subjectId !== null) out = out.filter(e => e.subjectId === subjectId);
    if (status) out = out.filter(e => e.status === status);
    out.sort((a,b) => (a.examDate || "").localeCompare(b.examDate || ""));
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

  async logDay(dateStr, allCompleted) {
    const { stores } = tx(this.db, ["dailyLog"], "readwrite");
    return promisifyRequest(stores.dailyLog.put({ date: dateStr, allCompleted: allCompleted ? 1 : 0 }));
  }

  async getDailyLog(dateStr) {
    const { stores } = tx(this.db, ["dailyLog"]);
    return promisifyRequest(stores.dailyLog.get(dateStr));
  }
}
