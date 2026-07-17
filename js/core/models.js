

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
function now() {
  return new Date().toISOString();
}

export function createCategoryModel(data = {}) {
  const ts = now();
  return {
    id: data.id || newId(),
    title: data.title || 'دسته‌ی بدون عنوان',
    description: data.description || '',
    coverImage: data.coverImage || null,
    themeColor: data.themeColor || '#3D6BFF',
    icon: data.icon || 'folder',
    createdAt: data.createdAt || ts,
    updatedAt: ts,
    lastOpened: data.lastOpened || null,
    progress: data.progress ?? 0,
    totalCards: data.totalCards ?? 0,
    favorite: data.favorite ?? false,
    archived: data.archived ?? false,
    aiContextId: data.aiContextId || null,
  };
}

export function createFlashcardModel(data = {}) {
  const ts = now();
  return {
    id: data.id || newId(),
    categoryId: data.categoryId || null,
    // Content-block system: ordered arrays, not plain strings (Section 5).
    frontContent: data.frontContent || [{ type: 'text', value: '' }],
    backContent: data.backContent || [{ type: 'text', value: '' }],
    frontImage: data.frontImage || null,
    backImage: data.backImage || null,
    audio: data.audio || null,
    bookmark: data.bookmark ?? false,
    favorite: data.favorite ?? false,
    difficulty: data.difficulty ?? 0,
    tags: data.tags || [],
    createdAt: data.createdAt || ts,
    updatedAt: ts,
    reviewCount: data.reviewCount ?? 0,
    lastReviewed: data.lastReviewed || null,
    nextReview: data.nextReview || ts,
    fsrsState: data.fsrsState || null, // populated when Phase 6 (Study Engine) runs
    source: data.source || 'manual',
    aiGenerated: data.aiGenerated ?? false,
    deleted: data.deleted ?? false, // soft delete
  };
}

export function createTagModel(data = {}) {
  return {
    id: data.id || newId(),
    name: data.name || '',
    color: data.color || null,
  };
}

export function createAiConversationModel(data = {}) {
  const ts = now();
  return {
    id: data.id || newId(),
    categoryId: data.categoryId || null,
    messages: data.messages || [],
    createdAt: data.createdAt || ts,
    updatedAt: ts,
  };
}

export function createPdfModel(data = {}) {
  const ts = now();
  return {
    id: data.id || newId(),
    categoryId: data.categoryId || null,
    fileName: data.fileName || '',
    fileSize: data.fileSize || 0,
    extractedText: data.extractedText || '',
    createdAt: data.createdAt || ts,
  };
}

