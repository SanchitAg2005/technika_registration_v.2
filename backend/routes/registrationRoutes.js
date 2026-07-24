const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const supabase = require('../config/supabase');
const { compressImage } = require('../utils/imageCompressor');
const { generateReceipt } = require('../services/pdfService');
const { queueParticipantSync } = require('../services/sheetsService');

// Multer configuration for file upload in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit before compression
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed!'), false);
    }
  }
});

// Helper: Generate unique random 6-character registration ID
const generateRegistrationId = async () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let unique = false;
  let regId = '';
  while (!unique) {
    regId = '';
    for (let i = 0; i < 6; i++) {
      regId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const existing = await User.findOne({ registrationId: regId });
    if (!existing) unique = true;
  }
  return regId;
};

// @route   POST /api/register
// @desc    Register a participant, upload screenshot, generate ID, and download receipt (no events)
// @access  Public
router.post('/', upload.single('paymentScreenshot'), async (req, res) => {
  try {
    const {
      name,
      age,
      gender,
      email,
      whatsapp,
      institution,
      course,
      semester,
      password,
      paymentUTR
    } = req.body;

    const sanitizedEmail = email ? email.toLowerCase().trim() : '';

    // 1. Validations
    if (!req.file) {
      return res.status(400).json({ message: 'Payment screenshot is required!' });
    }

    if (!sanitizedEmail || !sanitizedEmail.endsWith('@gmail.com')) {
      return res.status(400).json({ message: 'A valid Gmail address is required!' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long!' });
    }

    if (!paymentUTR || !/^\d{12}$/.test(paymentUTR.trim())) {
      return res.status(400).json({ message: 'Transaction UTR must be exactly 12 numeric digits.' });
    }
    const cleanedUTR = paymentUTR.trim();

    // Check unique UTR
    const existingUTR = await User.findOne({ paymentUTR: cleanedUTR });
    if (existingUTR) {
      return res.status(400).json({ message: 'This Payment UTR has already been used for registration!' });
    }

    // Check unique email
    const existingEmail = await User.findOne({ email: sanitizedEmail });
    if (existingEmail) {
      return res.status(400).json({ message: 'This email is already registered!' });
    }

    // 2. Generate Unique Registration ID
    const registrationId = await generateRegistrationId();

    // 3. Image Compression
    const compressedBuffer = await compressImage(req.file.buffer);

    // 4. Upload to Supabase Storage with local fallback on error (e.g. RLS policies, bucket issues)
    let paymentScreenshotUrl = '';
    const fileName = `${Date.now()}_${registrationId}.jpg`;
    
    let uploadedToSupabase = false;
    if (supabase) {
      try {
        const { data, error } = await supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'payment-screenshots')
          .upload(fileName, compressedBuffer, {
            contentType: 'image/jpeg',
            upsert: true
          });

        if (error) {
          throw error;
        }

        const { data: { publicUrl } } = supabase.storage
          .from(process.env.SUPABASE_BUCKET || 'payment-screenshots')
          .getPublicUrl(fileName);
        
        paymentScreenshotUrl = publicUrl;
        uploadedToSupabase = true;
        console.log('Payment screenshot successfully uploaded to Supabase Storage.');
      } catch (err) {
        console.warn(`[SUPABASE UPLOAD FAILED] falling back to local storage: ${err.message}`);
      }
    }

    // Local Fallback: If not uploaded to Supabase, save locally in public/uploads/
    if (!uploadedToSupabase) {
      try {
        if (process.env.VERCEL) {
          console.warn('[VERCEL WARNING] Uploading screenshot to local folder in Vercel serverless context. This file will NOT persist!');
        }
        const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const localPath = path.join(uploadsDir, fileName);
        fs.writeFileSync(localPath, compressedBuffer);
        
        // Set the path served by Express static
        paymentScreenshotUrl = `/uploads/${fileName}`;
        console.log(`Payment screenshot saved locally at: ${paymentScreenshotUrl}`);
      } catch (writeError) {
        console.error('[WRITE ERROR] Failed to write local screenshot file:', writeError.message);
        // Fallback to a placeholder URL so registration doesn't fail
        paymentScreenshotUrl = `/uploads/failed_local_write_${fileName}`;
        if (process.env.VERCEL) {
          console.warn('[VERCEL ERROR] Local write failed due to read-only filesystem. Configured SUPABASE_URL & SUPABASE_KEY are highly recommended!');
        }
      }
    }

    // 5. Hash Password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 6. Save Participant details in User collection
    const user = new User({
      registrationId,
      name,
      age: parseInt(age),
      gender,
      email: sanitizedEmail,
      whatsapp,
      institution,
      course,
      semester,
      passwordHash,
      paymentUTR: cleanedUTR,
      paymentScreenshotUrl
    });
    await user.save();

    // 7. Sync Google Sheets Synchronization (in background)
    queueParticipantSync(user).catch(err => console.error('[SHEETS BACKGROUND ERROR] Failed to sync participant:', err.message));

    // 8. Generate receipt PDF buffer (no events initially)
    const pdfBuffer = await generateReceipt(user, password, []);

    // 9. Send Response - stream PDF directly with metadata headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt_${registrationId}.pdf`);
    res.setHeader('Access-Control-Expose-Headers', 'X-Registration-ID, X-Participant-Name');
    res.setHeader('X-Registration-ID', registrationId);
    res.setHeader('X-Participant-Name', user.name);

    res.send(pdfBuffer);
  } catch (error) {
    console.error('Registration processing error:', error);
    res.status(500).json({ message: 'An internal server error occurred during registration.' });
  }
});

module.exports = router;
