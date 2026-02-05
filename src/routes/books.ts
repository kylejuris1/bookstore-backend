import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// Get all books
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('books')
      .select('*')
      .order('date_uploaded', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// Get a single book by book_id
router.get('/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('books')
      .select('*')
      .eq('book_id', bookId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Book not found' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// Log a book view (increment view count)
router.post('/:bookId/view', async (req, res) => {
  try {
    const { bookId } = req.params;

    // First, get the current views count
    const { data: bookData, error: fetchError } = await supabaseAdmin
      .from('books')
      .select('views')
      .eq('book_id', bookId)
      .single();

    if (fetchError) {
      console.error('Error fetching book for view logging:', fetchError);
      return res.status(404).json({ error: 'Book not found' });
    }

    // Increment the views count
    const currentViews = typeof bookData?.views === 'number' ? bookData.views : 0;
    const { data, error } = await supabaseAdmin
      .from('books')
      .update({ views: currentViews + 1 })
      .eq('book_id', bookId)
      .select('views')
      .single();

    if (error) {
      console.error('Error incrementing book views:', error);
      return res.status(500).json({ error: 'Failed to log view' });
    }

    res.json({ success: true, views: data?.views || 0 });
  } catch (error) {
    console.error('Error logging book view:', error);
    res.status(500).json({ error: 'Failed to log view' });
  }
});

export default router;

