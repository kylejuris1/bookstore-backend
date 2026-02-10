import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true, // Allow all origins in development (for Expo Go on phone)
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Android App Links verification
app.use("/.well-known", express.static(path.join(process.cwd(), "public", ".well-known")));

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Backend is running" });
});

// API routes
import bookRoutes from './routes/books';
import chapterRoutes from './routes/chapters';
import authRoutes from './routes/auth';
import paymentRoutes from './routes/payments';

app.use('/api/books', bookRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
});

