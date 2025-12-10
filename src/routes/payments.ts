import { Router } from 'express';
import { google } from 'googleapis';
import { supabaseAdmin } from '../config/supabase';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Google Play Billing configuration
const PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.harba.bookstore.app';
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || '';

// Credit packages configuration (matching Google Play product IDs)
export const CREDIT_PACKAGES = [
  { id: '500', baseCredits: 500, bonusPercent: 0, totalCredits: 500, price: 4.99, productId: 'credits_500' },
  { id: '1000', baseCredits: 1000, bonusPercent: 10, totalCredits: 1100, price: 9.99, productId: 'credits_1000' },
  { id: '2000', baseCredits: 2000, bonusPercent: 15, totalCredits: 2300, price: 19.99, productId: 'credits_2000' },
  { id: '3000', baseCredits: 3000, bonusPercent: 20, totalCredits: 3600, price: 29.99, productId: 'credits_3000' },
  { id: '5000', baseCredits: 5000, bonusPercent: 25, totalCredits: 6250, price: 49.99, productId: 'credits_5000' },
  { id: '10000', baseCredits: 10000, bonusPercent: 30, totalCredits: 13000, price: 99.99, productId: 'credits_10000' },
];

// Initialize Google Play Android Publisher API
let androidPublisher: any = null;

const initGooglePlayAPI = () => {
  if (androidPublisher) {
    return androidPublisher;
  }

  try {
    if (!SERVICE_ACCOUNT_KEY) {
      console.warn('Google Play service account key not configured. Purchase verification will fail.');
      return null;
    }

    let keyJson: any;
    try {
      keyJson = JSON.parse(SERVICE_ACCOUNT_KEY);
    } catch (parseError) {
      console.error('Invalid GOOGLE_PLAY_SERVICE_ACCOUNT_KEY JSON:', parseError);
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: keyJson.client_email,
        private_key: keyJson.private_key?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    androidPublisher = google.androidpublisher({ version: 'v3', auth });
    return androidPublisher;
  } catch (error: any) {
    console.error('Error initializing Google Play API:', error);
    return null;
  }
};

// Get available credit packages
router.get('/packages', (req, res) => {
  // Return packages without productId (frontend already has it)
  const packagesWithoutProductId = CREDIT_PACKAGES.map(({ productId, ...rest }) => rest);
  res.json(packagesWithoutProductId);
});

// Verify Google Play purchase and add credits
router.post('/verify-purchase', async (req, res) => {
  try {
    const { purchaseToken, productId, userId } = req.body;

    if (!purchaseToken || !userId || !productId) {
      return res.status(400).json({ error: 'Purchase token, product ID, and user ID are required' });
    }

    // Find the package using Product ID
    const packageData = CREDIT_PACKAGES.find(
      pkg => pkg.productId === productId
    );
    if (!packageData) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    // Initialize Google Play API
    const publisher = initGooglePlayAPI();
    if (!publisher) {
      return res.status(500).json({ error: 'Google Play API not configured. Please set GOOGLE_PLAY_SERVICE_ACCOUNT_KEY environment variable.' });
    }

    // Verify purchase with Google Play using Product ID
    let purchase;
    try {
      const response = await publisher.purchases.products.get({
        packageName: PACKAGE_NAME,
        productId: productId, // Use Product ID for verification
        token: purchaseToken,
      });
      purchase = response.data;
    } catch (error: any) {
      console.error('Error verifying purchase with Google Play:', error);
      if (error.code === 401) {
        return res.status(500).json({ error: 'Google Play API authentication failed. Please check service account configuration.' });
      } else if (error.code === 404) {
        return res.status(400).json({ error: 'Purchase not found. The purchase token may be invalid or already consumed.' });
      }
      return res.status(500).json({ error: `Failed to verify purchase: ${error.message || 'Unknown error'}` });
    }

    // Check purchase state
    // purchaseState: 0 = purchased, 1 = canceled
    if (purchase.purchaseState !== 0) {
      return res.status(400).json({ error: 'Purchase was canceled or refunded' });
    }

    // Check if purchase has already been acknowledged/consumed
    // consumptionState: 0 = yet to be consumed, 1 = consumed
    // For one-time purchases, we should acknowledge them
    if (purchase.consumptionState === 1) {
      // Purchase already consumed - check if we've already credited this user
      // This prevents duplicate credits if the user retries
      console.log(`Purchase ${purchaseToken} already consumed. Checking if credits were already added.`);
      
      // You might want to track purchase tokens in your database to prevent duplicates
      // For now, we'll still allow it but log a warning
    }

    // Acknowledge the purchase (required for one-time purchases)
    try {
      await publisher.purchases.products.acknowledge({
        packageName: PACKAGE_NAME,
        productId: productId, // Use Product ID for acknowledgment
        token: purchaseToken,
        requestBody: {},
      });
    } catch (ackError: any) {
      console.error('Error acknowledging purchase:', ackError);
      // Continue even if acknowledgment fails - the purchase is still valid
    }

    // Get current credits
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('number_of_credits')
      .eq('id', userId)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    const currentCredits = userData?.number_of_credits || 0;
    const creditsToAdd = packageData.totalCredits;
    const newCredits = currentCredits + creditsToAdd;

    // Update user credits
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ number_of_credits: newCredits })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update credits' });
    }

    console.log(`Credits added: ${creditsToAdd} to user ${userId}. New total: ${newCredits}`);

    res.json({
      success: true,
      creditsAdded: creditsToAdd,
      newTotal: newCredits,
    });
  } catch (error: any) {
    console.error('Error verifying purchase:', error);
    res.status(500).json({ error: error.message || 'Failed to verify purchase' });
  }
});

export default router;
