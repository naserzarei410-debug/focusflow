import { db } from './db.js';

class BaseRepository {
  constructor(storeName) {
    this.storeName = storeName;
  }

  async getAll() {
    const database = await db.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getById(id) {
    const database = await db.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async create(data) {
    const database = await db.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const req = store.add(data);
      req.onsuccess = () => resolve(data);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async put(data) {
    const database = await db.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(data);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async update(id, changes) {
    const current = await this.getById(id);
    if (!current) throw new Error(`Record with id ${id} not found in ${this.storeName}`);
    const updated = { ...current, ...changes };
    await this.put(updated);
    return updated;
  }

  async delete(id) {
    const database = await db.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getByIndex(indexName, indexValue) {
    const database = await db.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index(indexName);
      const req = index.getAll(indexValue);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

export const categoryRepository = new BaseRepository('categories');
export const flashcardRepository = new BaseRepository('flashcards');
export const studySessionRepository = new BaseRepository('study_sessions');
export const reviewHistoryRepository = new BaseRepository('review_history');
export const aiConversationRepository = new BaseRepository('ai_conversations');
export const examRepository = new BaseRepository('exams');
export const examResultRepository = new BaseRepository('exam_results');

