import { Router } from "express"
import Stripe from "stripe"
import { supabaseAdmin } from "../config/supabase"
import dotenv from "dotenv"

dotenv.config()

const router = Router()

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || ""
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" })
  : null

const ensureStripe = () => {
  if (!stripe) {
    throw new Error(
      "Stripe secret key not configured. Set STRIPE_SECRET_KEY in the environment."
    )
  }
  return stripe
}

// Credit packages configuration (matching Stripe product IDs)
export const CREDIT_PACKAGES = [
  { id: "500", baseCredits: 500, bonusPercent: 0, totalCredits: 500, price: 4.99, productId: "credits_500" },
  { id: "1000", baseCredits: 1000, bonusPercent: 10, totalCredits: 1100, price: 9.99, productId: "credits_1000" },
  { id: "2000", baseCredits: 2000, bonusPercent: 15, totalCredits: 2300, price: 19.99, productId: "credits_2000" },
  { id: "3000", baseCredits: 3000, bonusPercent: 20, totalCredits: 3600, price: 29.99, productId: "credits_3000" },
  { id: "5000", baseCredits: 5000, bonusPercent: 25, totalCredits: 6250, price: 49.99, productId: "credits_5000" },
  { id: "10000", baseCredits: 10000, bonusPercent: 30, totalCredits: 13000, price: 99.99, productId: "credits_10000" },
]

// Get available credit packages
router.get("/packages", (_req, res) => {
  // Return packages without productId (frontend already has it)
  const packagesWithoutProductId = CREDIT_PACKAGES.map(({ productId, ...rest }) => rest)
  res.json(packagesWithoutProductId)
})

// Create a Stripe Checkout Session for the selected package
router.post("/create-checkout-session", async (req, res) => {
  try {
    const { productId, userId } = req.body as { productId?: string; userId?: string }

    if (!productId || !userId) {
      return res
        .status(400)
        .json({ error: "Product ID and user ID are required to create a checkout session" })
    }

    const packageData = CREDIT_PACKAGES.find((pkg) => pkg.productId === productId)
    if (!packageData) {
      return res.status(400).json({ error: "Invalid product ID" })
    }

    const stripeClient = ensureStripe()
    const amount = Math.round(packageData.price * 100)

    const successUrl =
      process.env.CHECKOUT_SUCCESS_URL ||
      "bookstore://checkout-success?session_id={CHECKOUT_SESSION_ID}"
    const cancelUrl =
      process.env.CHECKOUT_CANCEL_URL || "bookstore://checkout-cancelled"

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Credits package ${packageData.id}`,
              metadata: {
                productId,
              },
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        productId,
        credits: packageData.totalCredits.toString(),
      },
    })

    return res.json({
      url: session.url,
      sessionId: session.id,
    })
  } catch (error: any) {
    console.error("Error creating checkout session:", error)
    return res
      .status(500)
      .json({ error: error?.message || "Failed to create checkout session" })
  }
})

// Create a PaymentIntent for Stripe PaymentSheet
router.post("/create-payment-intent", async (req, res) => {
  try {
    const { productId, userId } = req.body as { productId?: string; userId?: string }

    if (!productId || !userId) {
      return res
        .status(400)
        .json({ error: "Product ID and user ID are required to create a payment intent" })
    }

    const packageData = CREDIT_PACKAGES.find((pkg) => pkg.productId === productId)
    if (!packageData) {
      return res.status(400).json({ error: "Invalid product ID" })
    }

    const stripeClient = ensureStripe()
    const amount = Math.round(packageData.price * 100)

    const paymentIntent = await stripeClient.paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId,
        productId,
        credits: packageData.totalCredits.toString(),
      },
      description: `Credits package ${packageData.id}`,
    })

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    })
  } catch (error: any) {
    console.error("Error creating payment intent:", error)
    return res
      .status(500)
      .json({ error: error?.message || "Failed to create payment intent" })
  }
})

// Verify Stripe Checkout Session (or PaymentIntent fallback) and add credits
router.post("/verify-purchase", async (req, res) => {
  try {
    const { paymentIntentId, sessionId, userId, productId } = req.body as {
      paymentIntentId?: string
      sessionId?: string
      userId?: string
      productId?: string
    }

    if ((!paymentIntentId && !sessionId) || !userId) {
      return res
        .status(400)
        .json({ error: "Payment intent ID or session ID and user ID are required" })
    }

    const stripeClient = ensureStripe()
    let intentProductId: string | undefined = productId
    let intentAmount: number | undefined
    let intentUserId: string | undefined = userId

    if (sessionId) {
      const session = await stripeClient.checkout.sessions.retrieve(sessionId)
      if (session.status !== "complete") {
        return res.status(400).json({ error: "Checkout session not completed yet" })
      }
      intentProductId =
        (session.metadata?.productId as string | undefined) || intentProductId
      intentUserId = (session.metadata?.userId as string | undefined) || intentUserId
      intentAmount = session.amount_total || undefined
      if (session.payment_intent && typeof session.payment_intent === "string") {
        // Fetch intent for additional validation
        const intent = await stripeClient.paymentIntents.retrieve(session.payment_intent)
        intentAmount = intent.amount
        intentProductId =
          (intent.metadata?.productId as string | undefined) || intentProductId
        intentUserId = (intent.metadata?.userId as string | undefined) || intentUserId
      }
    } else if (paymentIntentId) {
      const intent = await stripeClient.paymentIntents.retrieve(paymentIntentId)
      if (intent.status !== "succeeded") {
        return res.status(400).json({ error: "Payment has not succeeded yet" })
      }
      intentProductId =
        (intent.metadata?.productId as string | undefined) || intentProductId
      intentUserId = (intent.metadata?.userId as string | undefined) || intentUserId
      intentAmount = intent.amount
    }

    if (!intentProductId) {
      return res.status(400).json({ error: "Product ID missing on payment" })
    }

    if (intentUserId && intentUserId !== userId) {
      return res
        .status(400)
        .json({ error: "Payment does not belong to this user" })
    }

    const packageData = CREDIT_PACKAGES.find((pkg) => pkg.productId === intentProductId)
    if (!packageData) {
      return res.status(400).json({ error: "Invalid product ID on payment" })
    }

    // Validate amount to prevent tampering
    const expectedAmount = Math.round(packageData.price * 100)
    if (intentAmount && intentAmount !== expectedAmount) {
      return res.status(400).json({ error: "Payment amount does not match product price" })
    }

    // Get current credits
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("number_of_credits")
      .eq("id", userId)
      .single()

    if (fetchError) {
      return res.status(500).json({ error: "Failed to fetch user data" })
    }

    const currentCredits = userData?.number_of_credits || 0
    const creditsToAdd = packageData.totalCredits
    const newCredits = currentCredits + creditsToAdd

    // Update user credits
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ number_of_credits: newCredits })
      .eq("id", userId)

    if (updateError) {
      return res.status(500).json({ error: "Failed to update credits" })
    }

    console.log(
      `Credits added via Stripe Checkout: ${creditsToAdd} to user ${userId}. New total: ${newCredits}`
    )

    res.json({
      success: true,
      creditsAdded: creditsToAdd,
      newTotal: newCredits,
    })
  } catch (error: any) {
    console.error("Error verifying Stripe purchase:", error)
    res.status(500).json({ error: error?.message || "Failed to verify purchase" })
  }
})

export default router
