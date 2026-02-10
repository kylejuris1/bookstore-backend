import { Router } from 'express';
import { randomUUID } from 'crypto';
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

// Delete current authenticated user (requires Bearer access token)
router.delete('/delete', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = data.user.id;

    // Remove profile data (best-effort)
    await supabaseAdmin.from('users').delete().eq('id', userId);
    await supabaseAdmin.from('guests').delete().eq('id', userId);

    // Remove auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('Failed to delete auth user:', deleteError);
      return res.status(500).json({ error: deleteError.message || 'Failed to delete account' });
    }

    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    console.error('Unexpected error deleting account:', err);
    res.status(500).json({ error: (err as any)?.message || 'Failed to delete account' });
  }
});

// Request OTP for account deletion (no sign-in UI required)
router.post('/delete-otp', async (req, res) => {
  try {
    const email = (req.body?.email as string | undefined)?.trim();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { error } = await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      },
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Unexpected error requesting deletion OTP:', err);
    return res.status(500).json({ error: err?.message || 'Failed to request deletion OTP' });
  }
});

// Verify OTP and delete account + all data (no existing session required)
router.post('/delete-confirm', async (req, res) => {
  try {
    const email = (req.body?.email as string | undefined)?.trim();
    const token = (req.body?.token as string | undefined)?.trim();
    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required' });
    }

    const { data, error } = await supabaseAdmin.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error || !data?.user?.id) {
      return res.status(400).json({ error: error?.message || 'Invalid code' });
    }

    const userId = data.user.id;

    // Remove profile data (best-effort)
    await supabaseAdmin.from('users').delete().eq('id', userId);
    await supabaseAdmin.from('guests').delete().eq('id', userId);

    // Remove auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('Failed to delete auth user:', deleteError);
      return res.status(500).json({ error: deleteError.message || 'Failed to delete account' });
    }

    return res.json({ success: true, message: 'Account deleted' });
  } catch (err: any) {
    console.error('Unexpected error confirming deletion:', err);
    return res.status(500).json({ error: err?.message || 'Failed to delete account' });
  }
});

// Get account profile by id (users first, then guests)
router.get('/account/:id', async (req, res) => {
  try {
    const accountId = req.params.id;
    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' });
    }

    const fetchFrom = async (table: 'users' | 'guests') => {
      return supabaseAdmin
        .from(table)
        .select('id, number_of_credits, bookmarks, paid_chapters, settings')
        .eq('id', accountId)
        .maybeSingle();
    };

    let result = await fetchFrom('users');
    if (result.data) {
      return res.json({ accountType: 'user', profile: result.data });
    }

    result = await fetchFrom('guests');
    if (result.data) {
      return res.json({ accountType: 'guest', profile: result.data });
    }

    return res.status(404).json({ error: 'Account not found' });
  } catch (err: any) {
    console.error('Error fetching account:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch account' });
  }
});

// Guest user creation
router.post('/guest', async (req, res) => {
  try {
    const providedId = req.body?.guestId as string | undefined;
    const isValidUUID = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
    const guestId = providedId && isValidUUID(providedId) ? providedId : randomUUID();

    console.log(`[guest] request id=${guestId}`);

    // First check if guest already exists
    const { data: existingGuest, error: checkError } = await supabaseAdmin
      .from('guests')
      .select('id')
      .eq('id', guestId)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is fine. Other errors are real problems.
      console.error('Error checking for existing guest:', checkError);
      return res.status(500).json({ error: checkError.message || 'Failed to check guest user' });
    }

    // If guest exists, just return the ID without modifying anything
    if (existingGuest) {
      console.log(`[guest] existing guest found id=${guestId}`);
      return res.json({ guestId });
    }

    // Guest doesn't exist, create new one with defaults
    const { data: newGuest, error: insertError } = await supabaseAdmin
      .from('guests')
      .insert({
        id: guestId,
        email: null,
        number_of_credits: 0,
        bookmarks: [],
        settings: { isGuest: true },
        paid_chapters: [],
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Failed to create guest user:', insertError);
      return res.status(500).json({ error: insertError.message || 'Failed to create guest user' });
    }

    console.log(`[guest] created new guest id=${newGuest?.id || guestId}`);
    res.json({ guestId: newGuest?.id || guestId });
  } catch (err) {
    console.error('Unexpected error creating guest user:', err);
    res.status(500).json({ error: (err as any)?.message || 'Failed to create guest user' });
  }
});

export default router;
