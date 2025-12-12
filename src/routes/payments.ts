import { Router } from 'express';
import Stripe from 'stripe';
import { supabaseAdmin } from '../config/supabase';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret
  ? new Stripe(stripeSecret, {
      // Use a stable, currently valid API version
      apiVersion: '2023-10-16',
    })
  : null;

type CreditPackage = {
  id: string;
  baseCredits: number;
  bonusPercent: number;
  totalCredits: number;
  price: number;
  productId: string; // logical product id used for one-time gating
  priceId?: string; // Stripe price id
  oneTime?: boolean;
  highlight?: boolean;
  tagline?: string;
};

// Credit packages mapped to Stripe price IDs (productId kept for backwards compatibility)
export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: '200',
    baseCredits: 200,
    bonusPercent: 200,
    totalCredits: 600,
    price: 1.99,
    productId: 'credits_200',
    priceId: process.env.STRIPE_PRICE_CREDITS_200 || 'price_1SdL8TGsleA9N3woLQDaF6tM',
    oneTime: true,
    highlight: true,
    tagline: 'Limited one-time starter boost',
  },
  {
    id: '500',
    baseCredits: 500,
    bonusPercent: 0,
    totalCredits: 500,
    price: 4.99,
    productId: 'credits_500',
    priceId: process.env.STRIPE_PRICE_CREDITS_500 || 'price_1SaEAjGsleA9N3wocKAUmNVX',
  },
  {
    id: '1000',
    baseCredits: 1000,
    bonusPercent: 10,
    totalCredits: 1100,
    price: 9.99,
    productId: 'credits_1000',
    priceId: process.env.STRIPE_PRICE_CREDITS_1000 || 'price_1SaED1GsleA9N3wou7xY2ECO',
  },
  {
    id: '2000',
    baseCredits: 2000,
    bonusPercent: 15,
    totalCredits: 2300,
    price: 19.99,
    productId: 'credits_2000',
    priceId: process.env.STRIPE_PRICE_CREDITS_2000 || 'price_1SaEE4GsleA9N3woSMToAtbj',
  },
  {
    id: '3000',
    baseCredits: 3000,
    bonusPercent: 20,
    totalCredits: 3600,
    price: 29.99,
    productId: 'credits_3000',
    priceId: process.env.STRIPE_PRICE_CREDITS_3000 || 'price_1SaEFTGsleA9N3woQFAeFwJg',
  },
  {
    id: '5000',
    baseCredits: 5000,
    bonusPercent: 25,
    totalCredits: 6250,
    price: 49.99,
    productId: 'credits_5000',
    priceId: process.env.STRIPE_PRICE_CREDITS_5000 || 'price_1SaEGmGsleA9N3woJQwraA5c',
  },
  {
    id: '10000',
    baseCredits: 10000,
    bonusPercent: 30,
    totalCredits: 13000,
    price: 99.99,
    productId: 'credits_10000',
    priceId: process.env.STRIPE_PRICE_CREDITS_10000 || 'price_1SaEHsGsleA9N3woD5yxGBJR',
  },
];

const findPackageById = (id: string) => CREDIT_PACKAGES.find((pkg) => pkg.id === id);

const ensureAccount = async (userId: string) => {
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
      .select('number_of_credits, settings')
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
    .select('number_of_credits, settings')
    .single();

  if (created.error || !created.data) {
    console.error('Failed to fetch or create account for purchase:', created.error);
    return { error: created.error };
  }

  return { table: 'guests' as const, data: created.data };
};

const parseSettings = (rawSettings: any) => {
  if (!rawSettings) return {};
  try {
    return typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;
  } catch (err) {
    console.error('Failed to parse settings JSON:', err);
    return {};
  }
};

// Get available credit packages, filtering one-time packs already owned
router.get('/packages', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || null;
    let availablePackages = CREDIT_PACKAGES;

    if (userId) {
      const fetched = await ensureAccount(userId);
      if ((fetched as any).error) {
        return res.status(500).json({ error: 'Failed to load packages' });
      }

      const userSettings = parseSettings((fetched as any).data?.settings);
      const purchasedProducts = Array.isArray(userSettings?.purchasedProducts)
        ? userSettings.purchasedProducts
        : [];
      const purchasedSet = new Set(purchasedProducts);

      availablePackages = CREDIT_PACKAGES.filter((pkg) => {
        if (pkg.oneTime && purchasedSet.has(pkg.productId)) {
          return false;
        }
        return true;
      });
    }

    res.json(
      availablePackages.map(({ priceId, ...rest }) => ({
        ...rest,
        priceId,
      })),
    );
  } catch (error) {
    console.error('Error returning packages:', error);
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

// Create Stripe Checkout session for a credit package
router.post('/stripe/checkout', async (req, res) => {
  try {
    const { packageId, userId, successUrl, cancelUrl } = req.body as {
      packageId?: string;
      userId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured on the server.' });
    }

    if (!packageId || !userId) {
      return res.status(400).json({ error: 'packageId and userId are required' });
    }

    const packageData = findPackageById(packageId);
    if (!packageData || !packageData.priceId) {
      return res.status(400).json({ error: 'Invalid or unavailable package' });
    }

    const ensured = await ensureAccount(userId);
    if ((ensured as any).error || !ensured.data) {
      return res.status(500).json({ error: 'Failed to fetch or create account for purchase' });
    }

    const userSettings = parseSettings(ensured.data.settings);
    const purchasedProducts = Array.isArray(userSettings?.purchasedProducts)
      ? userSettings.purchasedProducts
      : [];

    if (packageData.oneTime && purchasedProducts.includes(packageData.productId)) {
      return res.status(400).json({ error: 'Product already purchased' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price: packageData.priceId,
          quantity: 1,
        },
      ],
      client_reference_id: userId,
      metadata: {
        userId,
        packageId: packageData.id,
        productId: packageData.productId,
      },
      success_url: successUrl || 'https://example.com/stripe/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancelUrl || 'https://example.com/stripe/cancelled',
    });

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error: any) {
    console.error('Error creating Stripe Checkout session:', error);
    res.status(500).json({ error: error.message || 'Failed to start checkout' });
  }
});

// Create a PaymentIntent for Stripe Payment Sheet (mobile)
router.post('/stripe/payment-sheet', async (req, res) => {
  try {
    const { packageId, userId } = req.body as { packageId?: string; userId?: string };

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured on the server.' });
    }

    if (!packageId || !userId) {
      return res.status(400).json({ error: 'packageId and userId are required' });
    }

    const packageData = findPackageById(packageId);
    if (!packageData || !packageData.priceId) {
      return res.status(400).json({ error: 'Invalid or unavailable package' });
    }

    const ensured = await ensureAccount(userId);
    if ((ensured as any).error || !ensured.data) {
      return res.status(500).json({ error: 'Failed to fetch or create account for purchase' });
    }

    const userSettings = parseSettings(ensured.data.settings);
    const purchasedProducts = Array.isArray(userSettings?.purchasedProducts)
      ? userSettings.purchasedProducts
      : [];

    if (packageData.oneTime && purchasedProducts.includes(packageData.productId)) {
      return res.status(400).json({ error: 'Product already purchased' });
    }

    // Retrieve the price so amount/currency stays in sync with Stripe dashboard
    const price = await stripe.prices.retrieve(packageData.priceId);
    const amount = typeof price.unit_amount === 'number' ? price.unit_amount : Math.round(packageData.price * 100);
    const currency = price.currency || 'usd';

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata: {
        userId,
        packageId: packageData.id,
        productId: packageData.productId,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error: any) {
    console.error('Error creating PaymentIntent for Payment Sheet:', error);
    res.status(500).json({ error: error.message || 'Failed to start payment sheet' });
  }
});

// Confirm PaymentIntent status and credit the user (Payment Sheet)
router.post('/stripe/payment-sheet/confirm', async (req, res) => {
  try {
    const { paymentIntentId, userId } = req.body as { paymentIntentId?: string; userId?: string };

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured on the server.' });
    }

    if (!paymentIntentId || !userId) {
      return res.status(400).json({ error: 'paymentIntentId and userId are required' });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!intent) {
      return res.status(404).json({ error: 'PaymentIntent not found' });
    }

    if (intent.status !== 'succeeded' && intent.status !== 'requires_capture') {
      return res.status(400).json({ error: 'Payment not completed yet' });
    }

    const metadata = intent.metadata || {};
    const packageId = metadata.packageId;
    const productId = metadata.productId;
    const intentUserId = metadata.userId;

    if (!packageId || !productId) {
      return res.status(400).json({ error: 'Missing package metadata on intent' });
    }

    if (intentUserId && intentUserId !== userId) {
      return res.status(400).json({ error: 'PaymentIntent does not belong to this user' });
    }

    const packageData = findPackageById(packageId);
    if (!packageData) {
      return res.status(400).json({ error: 'Package not found' });
    }

    const ensured = await ensureAccount(userId);
    if ((ensured as any).error || !ensured.data) {
      return res.status(500).json({ error: 'Failed to fetch or create account for purchase' });
    }

    const accountTable = ensured.table;
    const userData = ensured.data;
    const userSettings = parseSettings(userData.settings);
    const purchasedProducts = Array.isArray(userSettings?.purchasedProducts)
      ? userSettings.purchasedProducts
      : [];
    const purchasedSet = new Set<string>(purchasedProducts);

    if (packageData.oneTime && purchasedSet.has(productId)) {
      return res.json({
        success: true,
        creditsAdded: 0,
        newTotal: userData.number_of_credits || 0,
        purchasedProducts: Array.from(purchasedSet),
        message: 'Product already purchased',
      });
    }

    const currentCredits = userData?.number_of_credits || 0;
    const creditsToAdd = packageData.totalCredits;
    const newCredits = currentCredits + creditsToAdd;

    if (packageData.oneTime) {
      purchasedSet.add(productId);
    }

    const updatedSettings = {
      ...userSettings,
      purchasedProducts: Array.from(purchasedSet),
    };

    const { error: updateError } = await supabaseAdmin
      .from(accountTable)
      .update({ number_of_credits: newCredits, settings: updatedSettings })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update credits' });
    }

    res.json({
      success: true,
      creditsAdded: creditsToAdd,
      newTotal: newCredits,
      purchasedProducts: Array.from(purchasedSet),
    });
  } catch (error: any) {
    console.error('Error confirming PaymentIntent:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm PaymentIntent' });
  }
});

// Confirm Checkout session status and credit the user
router.post('/stripe/confirm', async (req, res) => {
  try {
    const { sessionId, userId } = req.body as { sessionId?: string; userId?: string };

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured on the server.' });
    }

    if (!sessionId || !userId) {
      return res.status(400).json({ error: 'sessionId and userId are required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }

    // Only proceed for paid/complete sessions
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.status(400).json({ error: 'Payment not completed yet' });
    }

    const metadata = session.metadata || {};
    const packageId = metadata.packageId;
    const productId = metadata.productId;
    const sessionUserId = metadata.userId || session.client_reference_id;

    if (!packageId || !productId) {
      return res.status(400).json({ error: 'Missing package metadata on session' });
    }

    if (sessionUserId && sessionUserId !== userId) {
      return res.status(400).json({ error: 'Session does not belong to this user' });
    }

    const packageData = findPackageById(packageId);
    if (!packageData) {
      return res.status(400).json({ error: 'Package not found' });
    }

    const ensured = await ensureAccount(userId);
    if ((ensured as any).error || !ensured.data) {
      return res.status(500).json({ error: 'Failed to fetch or create account for purchase' });
    }

    const accountTable = ensured.table;
    const userData = ensured.data;
    const userSettings = parseSettings(userData.settings);
    const purchasedProducts = Array.isArray(userSettings?.purchasedProducts)
      ? userSettings.purchasedProducts
      : [];
    const purchasedSet = new Set<string>(purchasedProducts);

    // Idempotency: if already purchased and one-time, return current state
    if (packageData.oneTime && purchasedSet.has(productId)) {
      return res.json({
        success: true,
        creditsAdded: 0,
        newTotal: userData.number_of_credits || 0,
        purchasedProducts: Array.from(purchasedSet),
        message: 'Product already purchased',
      });
    }

    const currentCredits = userData?.number_of_credits || 0;
    const creditsToAdd = packageData.totalCredits;
    const newCredits = currentCredits + creditsToAdd;

    if (packageData.oneTime) {
      purchasedSet.add(productId);
    }

    const updatedSettings = {
      ...userSettings,
      purchasedProducts: Array.from(purchasedSet),
    };

    const { error: updateError } = await supabaseAdmin
      .from(accountTable)
      .update({ number_of_credits: newCredits, settings: updatedSettings })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update credits' });
    }

    res.json({
      success: true,
      creditsAdded: creditsToAdd,
      newTotal: newCredits,
      purchasedProducts: Array.from(purchasedSet),
    });
  } catch (error: any) {
    console.error('Error confirming Stripe checkout:', error);
    res.status(500).json({ error: error.message || 'Failed to confirm checkout' });
  }
});

export default router;
