import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase';

const router = Router();

// MagicKey authentication endpoint
router.post('/magiclink', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Send magic link via Supabase
    const { data, error } = await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: process.env.FRONTEND_URL || 'http://localhost:3000',
      },
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Magic link sent to email', data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send magic link' });
  }
});

// Verify magic link token
router.post('/verify', async (req, res) => {
  try {
    const { token, email } = req.body;

    if (!token || !email) {
      return res.status(400).json({ error: 'Token and email are required' });
    }

    // Verify the token
    const { data, error } = await supabaseAdmin.auth.verifyOtp({
      email,
      token,
      type: 'magiclink',
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Create or update user profile
    if (data.user) {
      const { error: profileError } = await supabaseAdmin
        .from('users')
        .upsert({
          id: data.user.id,
          authid: data.user.id,
          email: data.user.email || email,
          number_of_credits: 1250, // Default credits
          bookmarks: [],
          settings: {},
          paid_chapters: [],
        }, {
          onConflict: 'id',
        });

      if (profileError) {
        console.error('Error creating user profile:', profileError);
      }
    }

    res.json({ 
      message: 'Authentication successful',
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    
    // Verify token and get user
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({ user, profile });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;

