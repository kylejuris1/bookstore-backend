import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// Get all chapters for a book
router.get('/book/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('chapters')
      .select('*')
      .eq('book_id', bookId)
      .order('chapter_number', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// Get a specific chapter
router.get('/book/:bookId/chapter/:chapterNumber', async (req, res) => {
  try {
    const { bookId, chapterNumber } = req.params;

    const { data, error } = await supabaseAdmin
      .from('chapters')
      .select('*')
      .eq('book_id', bookId)
      .eq('chapter_number', parseInt(chapterNumber))
      .single();

    if (error) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chapter' });
  }
});

// Unlock a chapter (deducts credits and adds to paid_chapters)
router.post('/unlock', async (req, res) => {
  try {
    const { userId, bookId, chapterNum } = req.body;

    if (!userId || !bookId || !chapterNum) {
      return res.status(400).json({ error: 'User ID, book ID, and chapter number are required' });
    }

    // Chapters 1-5 are free
    if (chapterNum < 6) {
      return res.json({ success: true, message: 'Chapter is free', credits: null, paidChapters: null });
    }

    const chapterCost = 50;

    // Ensure account exists (users first, then guests)
    const ensureAccount = async () => {
      const baseProfile = {
        id: userId,
        email: null,
        number_of_credits: 0,
        bookmarks: [],
        settings: {},
        paid_chapters: [],
      };

      const fetchFrom = async (table: 'users' | 'guests') => {
        return supabaseAdmin
          .from(table)
          .select('number_of_credits, paid_chapters')
          .eq('id', userId)
          .maybeSingle();
      };

      let found = await fetchFrom('users');
      if (found.data) return { table: 'users' as const, data: found.data };

      found = await fetchFrom('guests');
      if (found.data) return { table: 'guests' as const, data: found.data };

      const created = await supabaseAdmin
        .from('guests')
        .upsert(baseProfile, { onConflict: 'id' })
        .select('number_of_credits, paid_chapters')
        .single();

      if (created.error || !created.data) {
        console.error('Failed to fetch or create account:', created.error);
        return { error: created.error };
      }

      return { table: 'guests' as const, data: created.data };
    };

    const ensured = await ensureAccount();
    if ((ensured as any).error || !ensured.data) {
      return res.status(500).json({ error: 'Failed to fetch or create account' });
    }

    const accountTable = ensured.table;
    const userData = ensured.data;

    // Check if chapter is already unlocked
    const paidChapters = Array.isArray(userData.paid_chapters) ? userData.paid_chapters : [];
    const chapterKey = `${bookId}:${chapterNum}`;
    if (paidChapters.includes(chapterKey)) {
      return res.json({ 
        success: true, 
        message: 'Chapter already unlocked', 
        credits: userData.number_of_credits,
        paidChapters: paidChapters 
      });
    }

    // Check if user has enough credits
    const currentCredits = userData.number_of_credits || 0;
    if (currentCredits < chapterCost) {
      return res.status(400).json({ 
        error: 'Insufficient credits', 
        required: chapterCost, 
        current: currentCredits 
      });
    }

    // Deduct credits and add chapter to paid_chapters
    const newCredits = currentCredits - chapterCost;
    const updatedPaidChapters = [...paidChapters, chapterKey];

    // Update in Supabase
    const { error: updateError } = await supabaseAdmin
      .from(accountTable)
      .update({ 
        number_of_credits: newCredits,
        paid_chapters: updatedPaidChapters
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error unlocking chapter:', updateError);
      return res.status(500).json({ error: 'Failed to unlock chapter' });
    }

    console.log(`Chapter unlocked: ${chapterKey} for user ${userId}. Credits deducted: ${chapterCost}. New total: ${newCredits}`);

    res.json({
      success: true,
      credits: newCredits,
      paidChapters: updatedPaidChapters,
    });
  } catch (error: any) {
    console.error('Error unlocking chapter:', error);
    res.status(500).json({ error: error.message || 'Failed to unlock chapter' });
  }
});

export default router;

