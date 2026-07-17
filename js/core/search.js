import { categoryRepository, flashcardRepository } from './repositories.js';


export async function globalSearch(query) {
  if (!query || !query.trim()) {
    return { categories: [], flashcards: [] };
  }
  
  const cleanQuery = query.trim().toLowerCase();
  
  const categories = await categoryRepository.getAll();
  const flashcards = await flashcardRepository.getAll();
  
  // 1. Search Categories (Title and Description)
  const matchingCategories = categories.filter(c => {
    if (c.archived) return false;
    const titleMatch = (c.title || '').toLowerCase().includes(cleanQuery);
    const descMatch = (c.description || '').toLowerCase().includes(cleanQuery);
    return titleMatch || descMatch;
  });
  
  // 2. Search Flashcards (Front/Back text and Tags)
  const matchingFlashcards = flashcards.filter(f => {
    if (f.deleted) return false;
    
    // Match tags
    const tagMatch = (f.tags || []).some(tag => tag.toLowerCase().includes(cleanQuery));
    if (tagMatch) return true;
    
    // Match front content
    const frontMatch = (f.frontContent || []).some(block => 
      block.type === 'text' && (block.value || '').toLowerCase().includes(cleanQuery)
    );
    if (frontMatch) return true;
    
    // Match back content
    const backMatch = (f.backContent || []).some(block => 
      block.type === 'text' && (block.value || '').toLowerCase().includes(cleanQuery)
    );
    return backMatch;
  });
  
  return {
    categories: matchingCategories,
    flashcards: matchingFlashcards
  };
}
