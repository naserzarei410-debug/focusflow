let dbInstance = null;

export const db = {
  getDb() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('personal-learning-os-db', 1);
      request.onerror = (e) => reject(e.target.error);
      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      request.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('settings')) {
          d.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!d.objectStoreNames.contains('categories')) {
          d.createObjectStore('categories', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('flashcards')) {
          const cardStore = d.createObjectStore('flashcards', { keyPath: 'id' });
          cardStore.createIndex('categoryId', 'categoryId', { unique: false });
          cardStore.createIndex('deleted', 'deleted', { unique: false });
        }
        if (!d.objectStoreNames.contains('study_sessions')) {
          const sessionStore = d.createObjectStore('study_sessions', { keyPath: 'id' });
          sessionStore.createIndex('categoryId', 'categoryId', { unique: false });
        }
        if (!d.objectStoreNames.contains('review_history')) {
          const historyStore = d.createObjectStore('review_history', { keyPath: 'id' });
          historyStore.createIndex('cardId', 'cardId', { unique: false });
        }
        if (!d.objectStoreNames.contains('ai_conversations')) {
          const convStore = d.createObjectStore('ai_conversations', { keyPath: 'id' });
          convStore.createIndex('categoryId', 'categoryId', { unique: false });
        }
        if (!d.objectStoreNames.contains('exams')) {
          const examStore = d.createObjectStore('exams', { keyPath: 'id' });
          examStore.createIndex('categoryId', 'categoryId', { unique: false });
        }
        if (!d.objectStoreNames.contains('exam_results')) {
          const resultStore = d.createObjectStore('exam_results', { keyPath: 'id' });
          resultStore.createIndex('examId', 'examId', { unique: false });
        }
      };
    });
  },

  async getSetting(key, defaultValue = '') {
    const database = await this.getDb();
    return new Promise((resolve) => {
      const transaction = database.transaction('settings', 'readonly');
      const store = transaction.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => resolve(defaultValue);
    });
  },

  async setSetting(key, value) {
    const database = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', 'readwrite');
      const store = transaction.objectStore('settings');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }
};
