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

// Log a view for a book
router.post('/:bookId/view', async (req, res) => {
  try {
    const { bookId } = req.params;

    // Fetch current views
    const { data, error } = await supabaseAdmin
      .from('books')
      .select('views')
      .eq('book_id', bookId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const currentViews = data.views || 0;
    const newViews = currentViews + 1;

    const { error: updateError } = await supabaseAdmin
      .from('books')
      .update({ views: newViews })
      .eq('book_id', bookId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to log view' });
    }

    res.json({ success: true, views: newViews });
  } catch (error) {
    console.error('Error logging view:', error);
    res.status(500).json({ error: 'Failed to log view' });
  }
});

export default router;

