import { Router } from 'express';
import Stripe from 'stripe';
import { supabaseAdmin } from '../config/supabase';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

// Credit packages configuration
export const CREDIT_PACKAGES = [
  { id: '500', baseCredits: 500, bonusPercent: 0, totalCredits: 500, price: 4.99, stripePriceId: 'price_1SaEAjGsleA9N3wocKAUmNVX' },
  { id: '1000', baseCredits: 1000, bonusPercent: 10, totalCredits: 1100, price: 9.99, stripePriceId: 'price_1SaED1GsleA9N3wou7xY2ECO' },
  { id: '2000', baseCredits: 2000, bonusPercent: 15, totalCredits: 2300, price: 19.99, stripePriceId: 'price_1SaEE4GsleA9N3woSMToAtbj' },
  { id: '3000', baseCredits: 3000, bonusPercent: 20, totalCredits: 3600, price: 29.99, stripePriceId: 'price_1SaEFTGsleA9N3woQFAeFwJg' },
  { id: '5000', baseCredits: 5000, bonusPercent: 25, totalCredits: 6250, price: 49.99, stripePriceId: 'price_1SaEGmGsleA9N3woJQwraA5c' },
  { id: '10000', baseCredits: 10000, bonusPercent: 30, totalCredits: 13000, price: 99.99, stripePriceId: 'price_1SaEHsGsleA9N3woD5yxGBJR' },
];

// Get available credit packages
router.get('/packages', (req, res) => {
  res.json(CREDIT_PACKAGES);
});

// Create payment intent
router.post('/create-payment-intent', async (req, res) => {
  try {
    const { packageId, userId } = req.body;

    if (!packageId || !userId) {
      return res.status(400).json({ error: 'Package ID and User ID are required' });
    }

    const packageData = CREDIT_PACKAGES.find(pkg => pkg.id === packageId);
    if (!packageData) {
      return res.status(400).json({ error: 'Invalid package ID' });
    }

    // Retrieve the Stripe Price to get the amount and currency
    const price = await stripe.prices.retrieve(packageData.stripePriceId);
    
    if (!price.unit_amount) {
      throw new Error(`Price ${packageData.stripePriceId} does not have a unit amount`);
    }

    // Create payment intent using the price's amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId,
        packageId,
        credits: packageData.totalCredits.toString(),
        stripePriceId: packageData.stripePriceId,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      package: packageData,
    });
  } catch (error: any) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: error.message || 'Failed to create payment intent' });
  }
});

// Webhook handler for Stripe events
// Note: This route needs raw body, handled in index.ts
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(400).send('Webhook secret not configured');
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig!, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { userId, credits } = paymentIntent.metadata;

    if (userId && credits) {
      try {
        // Get current credits
        const { data: userData, error: fetchError } = await supabaseAdmin
          .from('users')
          .select('number_of_credits')
          .eq('id', userId)
          .single();

        if (fetchError) {
          console.error('Error fetching user credits:', fetchError);
          return res.status(500).json({ error: 'Failed to fetch user data' });
        }

        const currentCredits = userData?.number_of_credits || 0;
        const newCredits = currentCredits + parseInt(credits);

        // Update user credits
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ number_of_credits: newCredits })
          .eq('id', userId);

        if (updateError) {
          console.error('Error updating user credits:', updateError);
          return res.status(500).json({ error: 'Failed to update credits' });
        }

        console.log(`Credits added: ${credits} to user ${userId}. New total: ${newCredits}`);
      } catch (error: any) {
        console.error('Error processing webhook:', error);
        return res.status(500).json({ error: 'Failed to process webhook' });
      }
    }
  }

  res.json({ received: true });
});

// Verify payment and add credits (for client-side confirmation)
router.post('/verify-payment', async (req, res) => {
  try {
    const { paymentIntentId, userId } = req.body;

    if (!paymentIntentId || !userId) {
      return res.status(400).json({ error: 'Payment Intent ID and User ID are required' });
    }

    // Retrieve payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const { credits } = paymentIntent.metadata;

    if (!credits) {
      return res.status(400).json({ error: 'Credits not found in payment metadata' });
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
    const newCredits = currentCredits + parseInt(credits);

    // Update user credits
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ number_of_credits: newCredits })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update credits' });
    }

    res.json({
      success: true,
      creditsAdded: parseInt(credits),
      newTotal: newCredits,
    });
  } catch (error: any) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: error.message || 'Failed to verify payment' });
  }
});

export default router;

